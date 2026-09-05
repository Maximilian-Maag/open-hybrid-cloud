import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { testDatabaseName, wipeIfUnaccountedFor } from './database'

/**
 * Against a real Postgres, and on a database of its own.
 *
 * What this function decides is "is the schema in front of me accounted for",
 * and every interesting case is a shape a real database can be in and a mock
 * cannot: a `public` full of tables with no `drizzle` schema at all, a journal
 * table that exists and is empty, a journal with rows. Faking the three queries
 * would test that the function asks them, which is not the part that was wrong.
 *
 * Its own database because it drops `public`. Running that against the worker's
 * database would take the schema out from under every test file that follows.
 */
const url = new URL(process.env.DATABASE_URL ?? '')
// Named after the database this worker holds, so a run in another worktree
// against the same Postgres cannot drop the one this file is using.
const PROBE = `${testDatabaseName()}_wipe_probe`
const adminUrl = new URL(url.toString())
adminUrl.pathname = '/postgres'
const probeUrl = new URL(url.toString())
probeUrl.pathname = `/${PROBE}`

const admin = postgres(adminUrl.toString(), { max: 1 })
let probe: postgres.Sql

/**
 * How long the database-level hooks may take.
 *
 * Two minutes, and it has been raised twice. CREATE DATABASE copies a template
 * and DROP DATABASE ... WITH (FORCE) evicts connections; both are cluster-level
 * statements that serialise against each other, and on CI four workers share one
 * Postgres. Fifteen seconds was not enough, sixty was not either — a run failed
 * with "Hook timed out in 60000ms" while all 2949 tests passed, on a PR that only
 * bumped pnpm.
 *
 * The ceiling is the second half of the fix, though, not the first: see below for
 * why the common path no longer does either statement.
 */
const DB_HOOK_TIMEOUT_MS = 120_000

/*
 * Made once if it is not already there, emptied between cases.
 *
 * `beforeEach` drops both schemas and recreates `public`, which reaches the
 * starting point every case wants — an empty `public`, no `drizzle` — for the
 * cost of one statement. So the DATABASE itself does not have to be new; it only
 * has to exist. Creating it unconditionally meant a DROP and a CREATE on every
 * run, which is the pair that timed the hook out, and it bought nothing that
 * `beforeEach` was not already providing.
 *
 * The name carries this worker's database name, so a run in another worktree
 * against the same Postgres cannot collide with the one this file is using.
 */
beforeAll(async () => {
  const [existing] = await admin<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_database WHERE datname = ${PROBE}
  `
  if (existing.n === 0) await admin.unsafe(`CREATE DATABASE "${PROBE}"`)
  probe = postgres(probeUrl.toString(), { max: 1 })
}, DB_HOOK_TIMEOUT_MS)

beforeEach(async () => {
  await probe.unsafe(`
    DROP SCHEMA IF EXISTS public CASCADE;
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    CREATE SCHEMA public;
  `)
})

/*
 * Connections closed for certain; the database dropped only if it can be.
 *
 * The drop is tidiness, not correctness — `beforeAll` reuses a leftover probe and
 * `beforeEach` empties it, so the next run is unaffected by one surviving. And
 * the name matches the pattern `make test-db-prune` already sweeps.
 *
 * So a failure here must not fail the file. DROP DATABASE ... WITH (FORCE) is the
 * slowest statement in it and the likeliest to be blocked by a peer worker; a red
 * suite over cleanup that does not matter is exactly the kind of failure that
 * teaches everyone to re-run rather than to read.
 *
 * That applied to the DROP and not to the two `end()` calls around it, which is
 * how this file failed a green run: all four tests passed, then `probe.end()`
 * exceeded its 5-second grace under a full parallel suite and took the file down
 * with it. Closing a connection is cleanup too. Everything in here is now
 * best-effort and says so on stderr when it does not work.
 */
const closeQuietly = async (sql: postgres.Sql | undefined, name: string) => {
  try {
    await sql?.end({ timeout: 5 })
  } catch (e) {
    console.warn(`[databaseWipe] ${name} did not close cleanly; the pool is torn down with the worker anyway: ${e}`)
  }
}

afterAll(async () => {
  await closeQuietly(probe, 'the probe connection')
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${PROBE}" WITH (FORCE)`)
  } catch (e) {
    console.warn(`[databaseWipe] could not drop the probe database ${PROBE}; \`make test-db-prune\` will: ${e}`)
  }
  await closeQuietly(admin, 'the admin connection')
}, DB_HOOK_TIMEOUT_MS)

const publicTables = async (db: postgres.Sql): Promise<number> => {
  const [{ n }] = await db<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'
  `
  return n
}

describe('wipeIfUnaccountedFor', () => {
  /*
   * The shape 31 databases on this instance are in: created before #147, when
   * the schema came from hand-written DDL and there was no journal at all. Every
   * run against one of them dies in beforeAll on `relation "app_config" already
   * exists`, and it dies the same way for ever.
   */
  it('empties a database whose schema no journal claims', async () => {
    await probe.unsafe(`CREATE TABLE app_config (id integer PRIMARY KEY)`)

    await expect(wipeIfUnaccountedFor(probe)).resolves.toBe(true)

    expect(await publicTables(probe)).toBe(0)
  })

  /*
   * The other way in: the migrator created its bookkeeping, hit the first
   * CREATE TABLE against a table already there, and gave up before recording
   * anything. The journal exists and accounts for nothing.
   */
  it('empties one whose journal exists and is empty', async () => {
    await probe.unsafe(`
      CREATE SCHEMA drizzle;
      CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text, created_at bigint);
      CREATE TABLE app_config (id integer PRIMARY KEY);
    `)

    await expect(wipeIfUnaccountedFor(probe)).resolves.toBe(true)

    expect(await publicTables(probe)).toBe(0)
    const [{ present }] = await probe<{ present: boolean }[]>`
      SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present
    `
    expect(present).toBe(false)
  })

  /*
   * The case that must NOT be wiped, and the reason the rule is written as
   * "accounts for none" rather than "accounts for all". A database one migration
   * behind is the ordinary state after a branch switch; the migrator catches it
   * up in a second, and rebuilding it from empty instead would make every branch
   * switch cost a full migration run.
   */
  it('leaves a database the journal partly accounts for alone', async () => {
    await probe.unsafe(`
      CREATE SCHEMA drizzle;
      CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text, created_at bigint);
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('0000_init', 1);
      CREATE TABLE app_config (id integer PRIMARY KEY);
    `)

    await expect(wipeIfUnaccountedFor(probe)).resolves.toBe(false)

    expect(await publicTables(probe)).toBe(1)
  })

  it('has nothing to do with a database that is already empty', async () => {
    await expect(wipeIfUnaccountedFor(probe)).resolves.toBe(false)
  })
})
