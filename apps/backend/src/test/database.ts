import { createHash } from 'node:crypto'
import postgres from 'postgres'

/**
 * Which database this test run uses.
 *
 * The suite is integration-tested against a real Postgres and truncates every
 * table between tests, so two runs sharing one database delete each other's
 * fixtures. That is not hypothetical: a mutation run (Stryker copies the source
 * tree into `.stryker-tmp/sandbox-*` and runs the suite in each copy) against the
 * same database as an ordinary `vitest run` produced 80 failures that had nothing
 * to do with the code.
 *
 * The name is derived from the working directory, which is what actually
 * distinguishes the runs that collide: every Stryker sandbox has its own, and so
 * does every checkout and every CI runner. `TEST_DB_SUFFIX` overrides it for the
 * one case a directory cannot tell apart — two runs started by hand in the same
 * checkout.
 */
const BASE = 'open_hybrid_cloud_test'

/** Only what this module reads, so a test can pass a fixture. */
type Env = { [key: string]: string | undefined }

export const testDatabaseName = (env: Env = process.env, cwd = process.cwd()): string => {
  const explicit = env.TEST_DB_SUFFIX?.trim()
  if (explicit) {
    // Postgres identifiers: keep it to something that never needs quoting.
    const safe = explicit.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24)
    return `${BASE}_${safe}`
  }
  return `${BASE}_${createHash('sha256').update(cwd).digest('hex').slice(0, 8)}`
}

/** The DATABASE_URL for this run, taken from PGHOST-style parts of the base URL. */
export const testDatabaseUrl = (env: Env = process.env, cwd = process.cwd()): string => {
  const base = env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres'
  const url = new URL(base)
  url.pathname = `/${testDatabaseName(env, cwd)}`
  return url.toString()
}

/** How many alternatives to try when the preferred database is already in use. */
const MAX_CANDIDATES = 8

const createIfMissing = async (admin: postgres.Sql, name: string): Promise<void> => {
  try {
    const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`
    if (existing.length === 0) {
      // CREATE DATABASE cannot run inside a transaction, hence unsafe().
      await admin.unsafe(`CREATE DATABASE "${name}"`)
    }
  } catch (e) {
    // Two runners can reach this at the same moment; "already exists" is success.
    if ((e as { code?: string })?.code !== '42P04') throw e
  }
}

/**
 * Claim a database for this run, and create it if it is not there yet.
 *
 * A name derived from the working directory separates the runs that usually
 * collide, but not two runs started from the SAME directory — a background full
 * suite while a single file is being iterated on, which is common enough that it
 * happened within minutes of the directory scheme landing.
 *
 * So the name is also *claimed*: a session-level advisory lock is taken on the
 * maintenance connection, and if it is already held the next candidate is tried.
 * The lock is released when `release()` closes that connection, or by Postgres
 * itself if the process dies — no stale state to clean up.
 */
export const acquireTestDatabase = async (
  databaseUrl: string,
): Promise<{ url: string; name: string; release: () => Promise<void> }> => {
  const url = new URL(databaseUrl)
  const preferred = url.pathname.replace(/^\//, '')
  const adminUrl = new URL(databaseUrl)
  adminUrl.pathname = '/postgres'

  const admin = postgres(adminUrl.toString(), { max: 1 })

  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const name = i === 0 ? preferred : `${preferred}_${i + 1}`
    const [{ locked }] = await admin<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${name})) AS locked
    `
    if (!locked) continue

    await createIfMissing(admin, name)
    const claimed = new URL(databaseUrl)
    claimed.pathname = `/${name}`
    return {
      url: claimed.toString(),
      name,
      release: () => admin.end({ timeout: 5 }),
    }
  }

  await admin.end({ timeout: 5 })
  throw new Error(
    `All ${MAX_CANDIDATES} candidate test databases for "${preferred}" are in use. ` +
      'Set TEST_DB_SUFFIX to pick your own, or wait for the other runs to finish.',
  )
}
