import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { auditLog, orders, infrastructureElements, products } from './schema'

/**
 * The hot-path indexes from issue #159, pinned in BOTH places they have to exist.
 *
 * A migration alone is not enough and neither is `schema.ts` alone:
 *
 *   - the migration is what a deployed database gets from `db:migrate`;
 *   - `schema.ts` is what `db:push` diffs against, so an index missing from it is
 *     an index `make db-push` DROPS the next time anyone runs it.
 *
 * That is the drift this repo already has for the pre-0032 migration indexes
 * (issue #141), and it is silent in both directions — nothing fails, the index is
 * simply gone and the page is slow again. Hence a test rather than a comment.
 *
 * Deliberately a source-level check with no database: the test schema is built
 * from the hand-written DDL in `src/test/setup.ts`, not from the migrations, so
 * querying `pg_indexes` here would assert something about that third copy
 * instead of about the two that ship. Making the test database run the real
 * migrations is issue #147.
 */
const MIGRATION = join(process.cwd(), 'drizzle', '0032_hot_path_indexes.sql')

type Table = Parameters<typeof getTableConfig>[0]

const CASES: { name: string; table: Table; columns: string[] }[] = [
  { name: 'audit_log_created_at_idx', table: auditLog, columns: ['created_at'] },
  { name: 'audit_log_user_created_at_idx', table: auditLog, columns: ['user_id', 'created_at'] },
  { name: 'orders_user_created_at_idx', table: orders, columns: ['user_id', 'created_at'] },
  { name: 'orders_status_created_at_idx', table: orders, columns: ['status', 'created_at'] },
  { name: 'orders_project_created_at_idx', table: orders, columns: ['project_id', 'created_at'] },
  { name: 'infrastructure_elements_project_idx', table: infrastructureElements, columns: ['project_id'] },
  { name: 'infrastructure_elements_order_idx', table: infrastructureElements, columns: ['order_id'] },
  { name: 'infrastructure_elements_deployed_at_idx', table: infrastructureElements, columns: ['deployed_at'] },
  { name: 'products_category_idx', table: products, columns: ['category_id'] },
]

const declaredIndexes = (t: Table) =>
  new Map(
    getTableConfig(t).indexes.map((idx) => [
      idx.config.name,
      (idx.config.columns as { name?: string }[]).map((c) => c.name ?? ''),
    ]),
  )

describe('the hot-path indexes from issue #159', () => {
  it.each(CASES)('$name is declared in schema.ts, so db:push keeps it', ({ name, table, columns }) => {
    const declared = declaredIndexes(table)
    expect([...declared.keys()], `schema.ts is missing ${name}`).toContain(name)
    // Column ORDER is the whole point of a composite index: (user_id, created_at)
    // serves "this user's rows, newest first" and (created_at, user_id) does not.
    expect(declared.get(name)).toEqual(columns)
  })

  it.each(CASES)('$name is created by migration 0032, so a deployed DB gets it', ({ name }) => {
    const sql = readFileSync(MIGRATION, 'utf8')
    expect(sql).toContain(`CREATE INDEX IF NOT EXISTS "${name}"`)
  })
})
