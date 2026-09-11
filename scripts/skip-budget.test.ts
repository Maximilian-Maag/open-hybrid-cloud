import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * `skip-budget.mjs` is the gate that makes a green e2e run mean something, and
 * until now it was the one piece of code here with no coverage at all (#377).
 *
 * Driven as a PROCESS rather than by importing it. The script's contract is its
 * exit code — that is the whole of what CI reads — and a unit test that called
 * an exported function would not have caught the regression that prompted this:
 * a serial-group flake counted as a skip and failed a job whose gate was green
 * (#374).
 */
const SCRIPT = path.resolve(__dirname, 'skip-budget.mjs')

let dir: string
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'skip-budget-')) })
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

type TestNode = {
  status?: string
  annotations?: { type: string; description?: string }[]
  results?: { status: string }[]
}

/** The shape `skip-budget.mjs` reads, with only the fields it looks at. */
const report = (specs: { file: string; title: string; tests: TestNode[] }[], stats = {}) => ({
  stats: { expected: 0, unexpected: 0, skipped: 0, flaky: 0, ...stats },
  suites: [{ title: 'root', specs }],
})

const run = (reportJson: unknown, budget: string | number = 0, name = 'report.json') => {
  const file = path.join(dir, name)
  writeFileSync(file, JSON.stringify(reportJson))
  const r = spawnSync(process.execPath, [SCRIPT, file, String(budget)], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}

/** Ran, passed on the retry — results `['skipped','passed']`. The #374 case. */
const serialFlake: TestNode = { status: 'expected', results: [{ status: 'skipped' }, { status: 'passed' }] }
/** A runtime `test.skip(cond, reason)`. */
const runtimeSkip = (reason: string): TestNode => ({
  status: 'skipped',
  annotations: [{ type: 'skip', description: reason }],
  results: [{ status: 'skipped' }],
})

describe('skip-budget: what counts as a skip', () => {
  it('does not count a serial-group flake that passed on its retry', () => {
    const { code, out } = run(report([{ file: 'a11y.spec.ts', title: 'contrast', tests: [serialFlake] }]))
    expect(code).toBe(0)
    expect(out).toContain('0 skipped')
  })

  it('counts a runtime skip, and prints the reason it gave', () => {
    const { code, err } = run(
      report([{ file: 'orders.spec.ts', title: 'opens an order', tests: [runtimeSkip('nothing on /orders to open')] }]),
    )
    expect(code).toBe(1)
    expect(err).toContain('orders.spec.ts › opens an order')
    expect(err).toContain('nothing on /orders to open')
  })

  /*
   * The other half of the #374 fix: the LAST result decides. A test whose
   * retries all skipped never ran, whatever `status` says.
   */
  it('counts a test still skipped after its retries', () => {
    const stillSkipped: TestNode = { status: 'expected', results: [{ status: 'skipped' }, { status: 'skipped' }] }
    const { code, err } = run(report([{ file: 'cart.spec.ts', title: 'checks out', tests: [stillSkipped] }]))
    expect(code).toBe(1)
    expect(err).toContain('cart.spec.ts › checks out')
  })

  it('counts a skip with no annotation, without inventing a reason', () => {
    const bare: TestNode = { status: 'skipped', results: [{ status: 'skipped' }] }
    const { code, err } = run(report([{ file: 'x.spec.ts', title: 'a fixme left behind', tests: [bare] }]))
    expect(code).toBe(1)
    expect(err).toContain('x.spec.ts › a fixme left behind')
    expect(err).not.toContain('—')
  })

  it('finds a skip however deeply the suites nest', () => {
    const nested = {
      stats: {},
      suites: [{ title: 'outer', suites: [{ title: 'middle', suites: [
        { title: 'inner', specs: [{ file: 'deep.spec.ts', title: 'buried', tests: [runtimeSkip('no fixture')] }] },
      ] }] }],
    }
    const { code, err } = run(nested)
    expect(code).toBe(1)
    expect(err).toContain('deep.spec.ts › buried')
  })
})

describe('skip-budget: the budget itself', () => {
  const twoSkips = report([
    { file: 'a.spec.ts', title: 'one', tests: [runtimeSkip('r1')] },
    { file: 'b.spec.ts', title: 'two', tests: [runtimeSkip('r2')] },
  ])

  it('passes when the count is exactly the budget', () => {
    expect(run(twoSkips, 2).code).toBe(0)
  })

  it('fails when the count is one over', () => {
    const { code, err } = run(twoSkips, 1)
    expect(code).toBe(1)
    expect(err).toContain('2 tests skipped')
    expect(err).toContain('more than the 1')
  })

  it('reports the tally on stdout either way', () => {
    expect(run(twoSkips, 2).out).toContain('2 skipped (budget 2)')
  })
})

/*
 * Exit 2, not 1, for every one of these. A gate that cannot read its input has
 * not found zero skips — it has found out nothing, and a job that treats the two
 * the same is back to reporting success for a run that executed nothing (#152).
 */
describe('skip-budget: when it cannot answer', () => {
  it('refuses a missing report rather than passing', () => {
    const r = spawnSync(process.execPath, [SCRIPT, path.join(dir, 'nope.json'), '0'], { encoding: 'utf8' })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('could not read the Playwright JSON report')
  })

  it('refuses a report that is not JSON', () => {
    const file = path.join(dir, 'broken.json')
    writeFileSync(file, '{ this is not json')
    const r = spawnSync(process.execPath, [SCRIPT, file, '0'], { encoding: 'utf8' })
    expect(r.status).toBe(2)
  })

  it('refuses a budget that is not a whole number', () => {
    expect(run(report([]), 'three').code).toBe(2)
    expect(run(report([]), '1.5').code).toBe(2)
    expect(run(report([]), -1).code).toBe(2)
  })

  it('refuses to run with no arguments', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('usage:')
  })
})
