#!/usr/bin/env node
/**
 * Fail a Playwright run that skipped more tests than it is allowed to.
 *
 * A skip is invisible in a green summary. That is how #152 went unnoticed: CI
 * never seeded the e2e database, so 56 of 283 tests skipped — every pipeline
 * stack test, most of admin-products, the whole order flow — and the report said
 * `{"expected": 0, "skipped": 283, "ok": true}`. A run that executed nothing
 * reported success, for months.
 *
 * The count alone would be enough to fail the job. It would not be enough to fix
 * it, so this prints WHICH tests skipped and the reason each one gave — a skip
 * with `test.skip(true, 'nothing on /orders to open')` is a data problem, and one
 * with no annotation is a `fixme` somebody left behind.
 *
 *   node scripts/skip-budget.mjs e2e-results.json 3
 */
import { readFileSync } from 'node:fs'

const [file, rawBudget] = process.argv.slice(2)
if (!file || rawBudget === undefined) {
  console.error('usage: skip-budget.mjs <playwright-json> <budget>')
  process.exit(2)
}

const budget = Number(rawBudget)
if (!Number.isInteger(budget) || budget < 0) {
  console.error(`budget must be a whole number of tests, got "${rawBudget}"`)
  process.exit(2)
}

let report
try {
  report = JSON.parse(readFileSync(file, 'utf8'))
} catch (e) {
  // Louder than a missing-file trace: a run that produced no report is a run
  // whose skips nobody counted, which is the thing this exists to prevent.
  console.error(`could not read the Playwright JSON report at ${file}: ${e.message}`)
  process.exit(2)
}

/** Every spec in the report, however deeply the suites nest. */
function* specs(suite) {
  for (const s of suite.suites ?? []) yield* specs(s)
  for (const spec of suite.specs ?? []) yield spec
}

const skipped = []
for (const suite of report.suites ?? []) {
  for (const spec of specs(suite)) {
    for (const test of spec.tests ?? []) {
      // `status` is the expected outcome ('skipped' for test.skip at declaration
      // time); the result carries a runtime skip. Either counts.
      const runtime = test.results?.some((r) => r.status === 'skipped')
      if (test.status !== 'skipped' && !runtime) continue
      const reason = test.annotations?.find((a) => a.type === 'skip' || a.type === 'fixme')?.description
      skipped.push(`${spec.file} › ${spec.title}${reason ? ` — ${reason}` : ''}`)
    }
  }
}

const stats = report.stats ?? {}
console.log(
  `${stats.expected ?? '?'} passed, ${stats.unexpected ?? '?'} failed, ${skipped.length} skipped (budget ${budget})`,
)

if (skipped.length <= budget) process.exit(0)

console.error(`\n${skipped.length} tests skipped, which is more than the ${budget} this job allows:\n`)
for (const line of skipped) console.error(`  ${line}`)
console.error(
  '\nA skipped test is not a passing test. If the database has nothing to walk to, seed it;\n' +
    'if the test is genuinely not applicable here, say so in the budget rather than in silence.',
)
process.exit(1)
