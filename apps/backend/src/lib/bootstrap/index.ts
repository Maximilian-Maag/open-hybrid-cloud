import path from 'node:path'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { db, client } from '@/lib/db/client'
import { users, branding, ciSources } from '@/lib/db/schema'
import bcrypt from 'bcryptjs'
import { reportConfigProblems } from '@/lib/config/validate'
import { insecureTransportRefusal, INSECURE_TRANSPORT_FLAG } from '@/lib/ci/transport'

// PostgreSQL error codes that mean the object already exists — safe to skip
// when the DB was seeded via db:push instead of the migration runner.
const IDEMPOTENT_PG_CODES = new Set(['42P07', '42701', '42710'])

async function runMigrations() {
  const migrationsFolder = path.join(process.cwd(), 'drizzle')
  const migrations = readMigrationFiles({ migrationsFolder })

  await client`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `

  for (const migration of migrations) {
    const applied = await client`SELECT id FROM "__drizzle_migrations" WHERE hash = ${migration.hash}`
    if (applied.length > 0) continue

    for (const statement of migration.sql) {
      const trimmed = statement.trim()
      if (!trimmed) continue
      try {
        await client.unsafe(trimmed)
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code
        if (IDEMPOTENT_PG_CODES.has(code ?? '')) {
          console.warn(`[bootstrap] skipped (${code}): ${trimmed.slice(0, 100)}`)
          continue
        }
        throw e
      }
    }

    await client`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`
    console.warn(`[bootstrap] migration applied: ${migration.hash.slice(0, 8)}`)
  }
}

let bootstrapped = false

/**
 * CI sources this deployment can no longer talk to, named at boot.
 *
 * #329 turned plaintext http to a non-loopback CI host into a refusal. That is
 * the right default, but on an existing deployment it changes behaviour: an
 * on-premise GitLab configured as `http://` still LOOKS fine in the admin UI and
 * only fails when somebody places an order, as a provisioning error nobody
 * connects to an upgrade.
 *
 * So it is said once, at boot, on stderr, naming each source and the switch.
 * Never fatal, for the reason `reportConfigProblems` gives: a server that
 * refuses one operation is easier to diagnose than one that will not start.
 */
export const reportInsecureCiSources = async (): Promise<void> => {
  let rows: { name: string; url: string }[]
  try {
    rows = await db.select({ name: ciSources.name, url: ciSources.url }).from(ciSources)
  } catch {
    // Pre-migration, or a database that has no `ci_sources` yet. Nothing to say.
    return
  }

  const refused = rows.filter((row) => insecureTransportRefusal(row.url) !== null)
  if (refused.length === 0) return

  console.error(
    `[bootstrap] ${refused.length} CI source(s) cannot be used: ` +
      refused.map((r) => `${r.name} (${r.url})`).join(', ') +
      `. Every call to them carries a credential, so plaintext http off loopback is refused (#329). ` +
      `Move them to https, or set ${INSECURE_TRANSPORT_FLAG}=1 to accept the risk.`,
  )
}

export const runBootstrap = async (): Promise<void> => {
  if (bootstrapped) return
  bootstrapped = true

  // Before anything else, and never fatal: a server that refuses logins is
  // easier to diagnose than one that will not start, but the reason has to be
  // on stderr at boot rather than surfacing later as a failed sign-in.
  reportConfigProblems()

  try {
    await runMigrations()
  } catch (err) {
    bootstrapped = false
    throw err
  }

  // After the migrations, so `ci_sources` is certainly there, and awaited rather
  // than fired and forgotten: the point is that it lands in the boot log next to
  // the other startup lines rather than somewhere in the middle of the first
  // request.
  await reportInsecureCiSources()

  // Seed branding data if it does not exist
  const brandingExists = await db.select({ id: branding.id }).from(branding).limit(1)
  if (brandingExists.length === 0) {
    await db.insert(branding).values({
      shopName: 'Open Hybrid Cloud',
      shopSubtitle: 'Self-Service Portal',
      // Matches the fallbacks the frontend uses when branding cannot be loaded
      // (see app/(dashboard)/layout.tsx). They disagreed: this seeded #ca8a04 with
      // a near-white #f5f5f4 secondary, so every primary button was painted in a
      // colour indistinguishable from the page and read as disabled — and #ca8a04
      // is the very value e2e/a11y.spec.ts uses as its "hostile" colour.
      primaryColor: '#131921',
      secondaryColor: '#febd69',
    })
    console.warn(`[bootstrap] Default branding created.`)
  }

  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD

  if (!email || !password) return

  const existing = await db.select({ id: users.id }).from(users).limit(1)
  if (existing.length > 0) return

  const passwordHash = await bcrypt.hash(password, 12)
  await db.insert(users).values({
    email,
    name: 'Root Admin',
    role: 'root',
    passwordHash,
    active: true,
  })

  console.warn(`[bootstrap] Root user created: ${email}`)
}
