/**
 * Rewrites the drizzle snapshot that `db:generate` diffs against (issue #141).
 *
 * drizzle-kit generates a migration by diffing schema.ts against ONE file: the
 * lexicographically last `drizzle/meta/*.json` that is not `_journal.json`
 * (`preparePrevSnapshot` in drizzle-kit). It never reads the .sql files. So when
 * migrations are hand-written — which is most of them here — the newest snapshot
 * on disk stays behind and the diff is taken against a database state that has
 * not existed for thirty migrations.
 *
 * What that produced before this script existed: `pnpm db:generate` re-emitted
 * every change since 0001, including `ALTER TABLE "pipeline_stacks" DROP COLUMN
 * "webhook_url"` for a column 0003 had already dropped. That raises 42703, which
 * is not in `IDEMPOTENT_PG_CODES`, so `runBootstrap` rethrows and the app does
 * not start.
 *
 * Run this after hand-writing a migration and updating schema.ts:
 *
 *     pnpm --filter backend db:snapshot
 *
 * `db:generate` writes its own snapshot, so it does not need this.
 *
 * `src/lib/db/journal.test.ts` fails if the snapshot and schema.ts disagree, so
 * forgetting is caught in CI rather than at the next boot.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateDrizzleJson } from 'drizzle-kit/api'
import * as schema from '../src/lib/db/schema'

const META = join(process.cwd(), 'drizzle', 'meta')

const journal = JSON.parse(readFileSync(join(META, '_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string }[]
}
const tip = journal.entries[journal.entries.length - 1]
if (!tip) throw new Error('the journal has no entries — nothing to snapshot against')

// The chain's previous link, picked the way drizzle-kit picks it so the file this
// writes is the one it will read back.
const existing = readdirSync(META).filter((name) => !name.startsWith('_')).sort()
const prevId = existing.length
  ? (JSON.parse(readFileSync(join(META, existing[existing.length - 1]), 'utf8')).id as string)
  : undefined

const snapshot = generateDrizzleJson(schema, prevId)
const name = `${String(tip.idx).padStart(4, '0')}_snapshot.json`
writeFileSync(join(META, name), JSON.stringify(snapshot, null, 2) + '\n')

console.warn(`[db:snapshot] wrote drizzle/meta/${name} for journal tip ${tip.tag}`)
