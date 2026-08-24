import path from 'node:path'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { db, client } from '@/lib/db/client'
import { users, branding } from '@/lib/db/schema'
import bcrypt from 'bcryptjs'
import { reportConfigProblems } from '@/lib/config/validate'
import { reconcileBrandingContrast } from './brandingContrast'

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

  // An existing row may predate the WCAG 1.4.6 rule that `updateBranding` now
  // enforces. Nudge it to the nearest shade of the same hue rather than leaving
  // a colour the API would refuse and the a11y gate would fail on — and record
  // the change in the audit log so the operator can see what happened and why.
  await reconcileBrandingContrast()

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
