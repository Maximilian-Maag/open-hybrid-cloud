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

/*
 * Made once, emptied between cases.
 *
 * CREATE DATABASE copies a template and takes seconds under load — doing it per
 * case timed the hook out on CI, where four workers share one Postgres. Dropping
 * the two schemas reaches the same starting point (an empty `public`, no
 * `drizzle`) for the cost of one statement.
 *
 * Sixty seconds for this hook rather than the suite's fifteen: it is the one
 * that does DROP DATABASE ... WITH (FORCE) and CREATE DATABASE, and a slow CI
 * runner is not a thing for it to fail on.
 */
beforeAll(async () => {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${PROBE}" WITH (FORCE)`)
  await admin.unsafe(`CREATE DATABASE "${PROBE}"`)
  probe = postgres(probeUrl.toString(), { max: 1 })
}, 60_000)

beforeEach(async () => {
  await probe.unsafe(`
    DROP SCHEMA IF EXISTS public CASCADE;
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    CREATE SCHEMA public;
  `)
})

afterAll(async () => {
  await probe?.end({ timeout: 5 })
  await admin.unsafe(`DROP DATABASE IF EXISTS "${PROBE}" WITH (FORCE)`)
  await admin.end({ timeout: 5 })
}, 60_000)

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
