import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The handbook's table overview is captioned "All database tables". It was not:
 * it listed 18 of 29, having quietly stopped being updated somewhere around the
 * point where features started adding tables of their own.
 *
 * That matters more than a normal doc gap, because the chapter presents itself
 * as the schema reference. A reader checking whether something is persisted, and
 * finding no row for it, gets a wrong answer with no hint that the list is
 * partial — `sessions`, `user_totp` and `user_recovery_codes` were all missing,
 * which is exactly the set someone reviewing how authentication stores things
 * would go looking for.
 *
 * Prose can be wrong quietly. A list that claims to be complete can be checked,
 * so check it.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const SCHEMA = path.join(REPO_ROOT, 'apps/backend/src/lib/db/schema.ts')
const HANDBOOK = path.join(REPO_ROOT, 'docs/handbook.tex')

/** Every table `schema.ts` actually declares. */
function schemaTables(): string[] {
  const src = readFileSync(SCHEMA, 'utf8')
  return [...src.matchAll(/pgTable\('([a-z_]+)'/g)].map((m) => m[1]).sort()
}

/** Every table named in the handbook's "All database tables" overview. */
function handbookTables(): string[] {
  const src = readFileSync(HANDBOOK, 'utf8')
  const start = src.indexOf('caption{All database tables}')
  expect(start, 'the overview table is gone from handbook.tex').toBeGreaterThan(-1)
  const table = src.slice(start, src.indexOf('bottomrule', start))
  // Rows read `\code{some\_table} & purpose \\`; LaTeX escapes the underscores.
  return [...table.matchAll(/\\code\{([a-z\\_]+)\}\s*&/g)]
    .map((m) => m[1].replace(/\\/g, ''))
    .sort()
}

describe('the handbook lists every database table', () => {
  it('finds tables on both sides', () => {
    // Guards the extraction: if either regex stopped matching, the comparison
    // below would pass vacuously or fail for the wrong reason.
    expect(schemaTables().length).toBeGreaterThan(20)
    expect(handbookTables().length).toBeGreaterThan(20)
  })

  it('names exactly the tables schema.ts declares', () => {
    const inSchema = schemaTables()
    const inHandbook = handbookTables()

    const missing = inSchema.filter((t) => !inHandbook.includes(t))
    const extra = inHandbook.filter((t) => !inSchema.includes(t))

    expect(
      { missing, extra },
      missing.length
        ? `handbook.tex is missing: ${missing.join(', ')}`
        : `handbook.tex names tables that do not exist: ${extra.join(', ')}`,
    ).toEqual({ missing: [], extra: [] })
  })
})
