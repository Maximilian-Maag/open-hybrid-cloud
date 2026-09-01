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
 * How many alternatives to try when the preferred database is already in use.
 *
 * This is the ceiling on test concurrency, not just on parallel runs: with
 * `fileParallelism` on, every Vitest worker claims one of these. Keep it
 * comfortably above `maxWorkers` in vitest.config.ts so a second run started by
 * hand still finds a free name.
 */
const MAX_CANDIDATES = 16

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
/**
 * Throw away a schema the migration journal does not account for.
 *
 * The migrator only ever adds. It reads `drizzle.__drizzle_migrations`, applies
 * what is missing, and assumes anything already in `public` is there because it
 * put it there. When that is false the first `CREATE TABLE` fails with
 * `relation "app_config" already exists`, in `beforeAll`, before a single test
 * runs — and it fails again on every subsequent run, because nothing in the
 * cycle can record what is already applied. The database is not stale, it is
 * unusable, and only dropping it by hand brings it back (#308).
 *
 * Two things put a database in that state. Databases created before #147 got
 * their schema from hand-written DDL and have no journal at all — a survey of
 * this Postgres found 31 of them. And a migration run interrupted after the DDL
 * but before the bookkeeping leaves the same shape.
 *
 * So: if `public` holds tables and the journal accounts for none of them, empty
 * the database and let the migrator build it from nothing. That is safe in a way
 * it would never be in production — the name is derived from the working
 * directory precisely so that this database belongs to this run, the worker
 * holds an advisory lock on it, and every test truncates the tables anyway.
 *
 * Deliberately narrow. A journal with SOME rows is an ordinary out-of-date
 * database and the migrator handles it; wiping that would turn a one-second
 * catch-up into a full rebuild on every branch switch.
 *
 * @returns whether it wiped, which the caller reports so the rebuild is visible.
 */
export const wipeIfUnaccountedFor = async (db: postgres.Sql): Promise<boolean> => {
  const [{ tables }] = await db<{ tables: number }[]>`
    SELECT count(*)::int AS tables FROM pg_tables WHERE schemaname = 'public'
  `
  if (tables === 0) return false

  // Two statements, not one CASE: Postgres resolves relation names when it
  // parses, so a subquery against a missing journal table is an error even in a
  // branch that would not be taken.
  const [{ present }] = await db<{ present: boolean }[]>`
    SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present
  `
  if (present) {
    const [{ applied }] = await db<{ applied: number }[]>`
      SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations
    `
    if (applied > 0) return false
  }

  await db.unsafe(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    DROP SCHEMA IF EXISTS drizzle CASCADE;
  `)
  return true
}

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
      'Each Vitest worker claims one, so this usually means maxWorkers (vitest.config.ts) ' +
      `is above MAX_CANDIDATES (${MAX_CANDIDATES}); otherwise another run is holding them — ` +
      'set TEST_DB_SUFFIX to pick your own, or wait for it to finish.',
  )
}
