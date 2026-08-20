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

/**
 * Create the run's database if it is not there yet.
 *
 * Connects to the `postgres` maintenance database, because a database cannot be
 * created from inside itself. Concurrent runners can race here, so "already
 * exists" (42P04) is a success, not an error.
 */
export const ensureTestDatabase = async (databaseUrl: string): Promise<void> => {
  const url = new URL(databaseUrl)
  const name = url.pathname.replace(/^\//, '')
  url.pathname = '/postgres'

  const admin = postgres(url.toString(), { max: 1 })
  try {
    const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`
    if (existing.length === 0) {
      // CREATE DATABASE cannot run inside a transaction, hence unsafe().
      await admin.unsafe(`CREATE DATABASE "${name}"`)
    }
  } catch (e) {
    if ((e as { code?: string })?.code !== '42P04') throw e
  } finally {
    await admin.end({ timeout: 5 })
  }
}
