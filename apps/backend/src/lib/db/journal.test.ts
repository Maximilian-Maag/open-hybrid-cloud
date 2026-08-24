import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

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

    expect([...tags].sort()).toEqual(files)
    expect(tags).toEqual([...tags])
    expect(new Set(tags).size).toBe(tags.length)

    const idxs = journal().map((entry) => entry.idx)
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b))
    expect(new Set(idxs).size).toBe(idxs.length)
  })
})
