/**
 * Drop the test databases nothing is using.
 *
 * Every Vitest worker claims a database named after the working directory, and
 * every Stryker sandbox and every git worktree is a different working directory.
 * Nothing has ever removed them. A survey of one developer's Postgres found 328
 * `open_hybrid_cloud_test_*` databases holding about 3 GB between them, most of
 * them created before #147 and unusable ever since.
 *
 * Safe by construction, in three ways:
 *
 *   * only names beginning with the test prefix are considered at all;
 *   * each candidate must yield to `pg_try_advisory_lock` on the same key
 *     `acquireTestDatabase` uses, so a database a running suite holds is skipped
 *     rather than pulled out from under it;
 *   * it only lists. Dropping requires `--yes`, typed by a person.
 *
 * The current run's own database is dropped like any other when it is idle.
 * That is the point — it is rebuilt from the migrations on the next run, which
 * is the same thing `wipeIfUnaccountedFor` does and takes about a second.
 */
import postgres from 'postgres'
import { testDatabaseName } from '../src/test/database'

// tsx compiles this to CJS, where a top-level await is a syntax error.
async function main(): Promise<void> {
  const PREFIX = 'open_hybrid_cloud_test'
  const commit = process.argv.includes('--yes')

/** A report, not a log: it goes to stdout so it can be piped. */
const say = (line: string): void => void process.stdout.write(`${line}\n`)

  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (!base) {
    console.error('Set DATABASE_URL (or TEST_DATABASE_URL) to the Postgres this repo tests against.')
    process.exit(1)
  }

  const adminUrl = new URL(base)
  adminUrl.pathname = '/postgres'
  const admin = postgres(adminUrl.toString(), { max: 1 })

  const mine = testDatabaseName()
  const rows = await admin<{ datname: string; size: string }[]>`
    SELECT datname, pg_size_pretty(pg_database_size(datname)) AS size
    FROM pg_database
    WHERE datname LIKE ${`${PREFIX}%`}
    ORDER BY datname
  `

  let dropped = 0
  let busy = 0
  for (const { datname, size } of rows) {
    const [{ locked }] = await admin<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${datname})) AS locked
    `
    if (!locked) {
      say(`skip  ${datname.padEnd(38)} ${size.padStart(8)}  in use by a running suite`)
      busy++
      continue
    }

    const note = datname === mine ? '  (this checkout’s; rebuilt on the next run)' : ''
    if (commit) {
      // FORCE: a suite that died without closing its pool leaves a connection
      // behind, and waiting for it would mean waiting for ever.
      await admin.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`)
      say(`drop  ${datname.padEnd(38)} ${size.padStart(8)}${note}`)
    } else {
      say(`would ${datname.padEnd(38)} ${size.padStart(8)}${note}`)
    }
    await admin`SELECT pg_advisory_unlock(hashtext(${datname}))`
    dropped++
  }

  say(commit
      ? `\n${dropped} dropped, ${busy} left alone.`
      : `\n${dropped} would be dropped, ${busy} in use. Re-run with --yes to do it.`,
  )
  await admin.end({ timeout: 5 })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
