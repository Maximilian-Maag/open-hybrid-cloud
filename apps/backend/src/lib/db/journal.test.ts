import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import type * as DrizzleKitApiModule from 'drizzle-kit/api'

type DrizzleKitApi = typeof DrizzleKitApiModule

/**
 * The migration journal, checked against the one rule drizzle actually applies.
 *
 * `pg-core/dialect.js` decides whether to run a migration with
 *
 *     if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
 *
 * — a strict `<` against the `when` of the last migration it applied. So two
 * entries sharing a `when` are not a tidiness problem: the first one applied
 * raises the watermark to that value, and every later entry with the same value
 * fails the comparison and is SKIPPED, with no error and no output.
 *
 * That happened. Five entries (0020, 0022, 0023, 0024, 0025) all carried
 * 1787702400000 after several branches were rebased in parallel, each having
 * computed `when` relative to its own base. On a fresh database four migrations
 * would never have run — including 0025, the rotation that closes the empty
 * callback-secret hole, so the security fix would have been present in the
 * source and absent from the database.
 */
const DRIZZLE_DIR = join(process.cwd(), 'drizzle')

interface JournalEntry {
  idx: number
  when: number
  tag: string
}

const journal = (): JournalEntry[] =>
  JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')).entries

describe('the migration journal', () => {
  it('has a strictly increasing `when`, because drizzle compares with <', () => {
    const entries = journal()
    const notIncreasing = entries
      .map((entry, i) => ({ entry, prev: entries[i - 1] }))
      .filter(({ entry, prev }) => prev !== undefined && entry.when <= prev.when)
      .map(({ entry, prev }) => `${entry.tag} (${entry.when}) does not come after ${prev.tag} (${prev.when})`)

    expect(notIncreasing, notIncreasing.join('\n')).toEqual([])
  })

  it('lists every migration file exactly once, in idx order', () => {
    const files = readdirSync(DRIZZLE_DIR)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.replace(/\.sql$/, ''))
      .sort()
    const tags = journal().map((entry) => entry.tag)

    // Compared in order, not as sets. `files` is sorted, and the tags are
    // zero-padded, so lexical order is numeric order — which is the order the
    // journal must already be in. Sorting `tags` before comparing (or comparing
    // it to a copy of itself, as this did) throws away the only part that says
    // anything: that entry N really is the Nth migration.
    expect(tags).toEqual(files)
    expect(new Set(tags).size).toBe(tags.length)

    const idxs = journal().map((entry) => entry.idx)
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b))
    expect(new Set(idxs).size).toBe(idxs.length)
  })
})

/**
 * The snapshot `db:generate` diffs against, checked against schema.ts.
 *
 * drizzle-kit never reads the .sql files when generating. It reads ONE file — the
 * lexicographically last `drizzle/meta/*.json` that is not `_journal.json`
 * (`preparePrevSnapshot`) — and emits whatever turns that into schema.ts. Because
 * most migrations here are hand-written, `meta/` held only `0000_snapshot.json`
 * and `0001_snapshot.json` while the journal listed 28 migrations, so the diff was
 * taken against the database as it stood thirty migrations ago.
 *
 * What that emitted (issue #141), among 194 lines of already-applied DDL:
 *
 *     ALTER TABLE "pipeline_stacks" DROP COLUMN "webhook_url";
 *
 * — a column migration 0003 had already dropped. Postgres answers 42703, which is
 * not one of `IDEMPOTENT_PG_CODES` in lib/bootstrap, so `runBootstrap` rethrows
 * and the app does not boot. `pnpm db:generate` is a documented workflow, so the
 * documented workflow produced a file that stopped the server from starting.
 *
 * This fails if the snapshot ever falls behind again. `pnpm --filter backend
 * db:snapshot` is what fixes it after a hand-written migration; `db:generate`
 * writes the snapshot itself.
 */
describe('the drizzle snapshot', () => {
  // Picked exactly as drizzle-kit picks it, not by name: reproducing the choice
  // is the only way this test speaks about the file that will actually be used.
  const snapshotFiles = () =>
    readdirSync(join(DRIZZLE_DIR, 'meta'))
      .filter((name) => !name.startsWith('_'))
      .sort()

  it('is named for the newest migration in the journal', () => {
    const entries = journal()
    const tip = entries[entries.length - 1]
    const files = snapshotFiles()

    expect(files[files.length - 1]).toBe(`${String(tip.idx).padStart(4, '0')}_snapshot.json`)
  })

  it('describes the same schema as schema.ts, so db:generate emits nothing', async () => {
    // Loaded through `createRequire` rather than `import`: drizzle-kit's ESM
    // build carries an esbuild shim that throws "Dynamic require of fs is not
    // supported" the moment anything in it reaches for a node builtin. Its CJS
    // build is the one that works, and this is a node-environment test.
    const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)(
      'drizzle-kit/api',
    ) as DrizzleKitApi
    const schema = await import('./schema')

    const files = snapshotFiles()
    const prev = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', files[files.length - 1]), 'utf8'))
    const cur = generateDrizzleJson(schema, prev.id)

    // Not "the file matches byte for byte": the snapshot carries a random uuid per
    // write, so equality would fail on every regeneration. What has to hold is
    // that the diff drizzle-kit takes is empty.
    const statements = await generateMigration(prev, cur)

    expect(statements, statements.join('\n')).toEqual([])
  })
})
