import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { infrastructureElements, unclaimedStates, driftReportState, auditLog, pipelineStacks } from '@/lib/db/schema'
import {
  createUser, createCategory, createProduct, createCiSource,
  createEnvironment, createProject, createOrder, createInfraElement,
} from '@/test/helpers'
import { recordDriftReport, driftReportStatus, driftTargets } from './driftReports'

/**
 * Recording a drift report (#108).
 *
 * The report arrives from CI over a shared secret and is UNTRUSTED. What it may
 * and may not do is the substance of this file: it may annotate an active
 * element it can identify, and nothing else. It may never create, delete or
 * decommission anything.
 */
const AT = new Date('2026-09-10T06:00:00.000Z')

const scenario = async (over: { status?: string; stateKeys?: Record<string, string> } = {}) => {
  const user = await createUser({ email: `drift-${Math.random()}@test.dev` })
  const category = await createCategory()
  const product = await createProduct(category.id)
  const ci = await createCiSource()
  const environment = await createEnvironment(ci.id)
  const project = await createProject(user.id)
  const order = await createOrder(project.id, product.id, environment.id, user.id, { status: 'completed' })
  const element = await createInfraElement(order.id, project.id, environment.id, product.id, {
    status: over.status ?? 'active',
    stateKeys: over.stateKeys ?? { '1': 'web-01-o42' },
  })
  return { element }
}

const reload = async (id: number) => {
  const [row] = await db.select().from(infrastructureElements).where(eq(infrastructureElements.id, id))
  return row
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('recordDriftReport', () => {
  it('records a clean check against the element that owns the state key', async () => {
    const { element } = await scenario()

    const out = await recordDriftReport({ checkedAt: AT, results: [{ stateKey: 'web-01-o42', outcome: 'clean' }] })

    expect(out).toEqual({ matched: 1, unclaimed: 0, ignored: 0 })
    const row = await reload(element.id)
    expect(row.lastRefreshedAt?.toISOString()).toBe(AT.toISOString())
    expect(row.lastRefreshOutcome).toBe('clean')
    expect(row.driftDetectedAt).toBeNull()
  })

  it('records drift with the resources the plan named', async () => {
    const { element } = await scenario()
    const summary = { resources: [{ address: 'module.vm.linode_instance.this', action: 'update' }] }

    await recordDriftReport({ checkedAt: AT, results: [{ stateKey: 'web-01-o42', outcome: 'drifted', summary }] })

    const row = await reload(element.id)
    expect(row.lastRefreshOutcome).toBe('drifted')
    expect(row.driftDetectedAt?.toISOString()).toBe(AT.toISOString())
    expect(row.driftSummary).toEqual(summary)
  })

  // Drift that has been fixed must stop being reported, or the badge is
  // permanent and stops meaning anything.
  it('clears drift when a later report comes back clean', async () => {
    const { element } = await scenario()
    await recordDriftReport({
      checkedAt: AT,
      results: [{ stateKey: 'web-01-o42', outcome: 'drifted', summary: { resources: [{ address: 'a', action: 'update' }] } }],
    })

    const later = new Date(AT.getTime() + 3_600_000)
    await recordDriftReport({ checkedAt: later, results: [{ stateKey: 'web-01-o42', outcome: 'clean' }] })

    const row = await reload(element.id)
    expect(row.driftDetectedAt).toBeNull()
    expect(row.driftSummary).toBeNull()
    expect(row.lastRefreshOutcome).toBe('clean')
  })

  /*
   * `locked` and `error` mean the plan could not run. Treating either as "no
   * drift" would clear a real finding because a teardown happened to hold the
   * state lock at that minute — silence reported as health, which is the exact
   * confusion #108 opens with.
   */
  it.each(['locked', 'error'] as const)('leaves existing drift alone on a %s result', async (outcome) => {
    const { element } = await scenario()
    const summary = { resources: [{ address: 'module.vm.linode_instance.this', action: 'delete' }] }
    await recordDriftReport({ checkedAt: AT, results: [{ stateKey: 'web-01-o42', outcome: 'drifted', summary }] })

    const later = new Date(AT.getTime() + 3_600_000)
    await recordDriftReport({ checkedAt: later, results: [{ stateKey: 'web-01-o42', outcome }] })

    const row = await reload(element.id)
    expect(row.driftSummary, 'the drift was cleared by a check that never ran').toEqual(summary)
    expect(row.driftDetectedAt?.toISOString()).toBe(AT.toISOString())
    // The outcome and the timestamp still move: we did try, and when.
    expect(row.lastRefreshOutcome).toBe(outcome)
    expect(row.lastRefreshedAt?.toISOString()).toBe(later.toISOString())
  })

  it('records a state key no element claims as an observation', async () => {
    await scenario()

    const out = await recordDriftReport({
      checkedAt: AT,
      results: [{ stateKey: 'left-behind-o7', outcome: 'drifted', summary: { resources: [] } }],
    })

    expect(out).toEqual({ matched: 0, unclaimed: 1, ignored: 0 })
    const [row] = await db.select().from(unclaimedStates).where(eq(unclaimedStates.stateKey, 'left-behind-o7'))
    expect(row.outcome).toBe('drifted')
  })

  // How long a state has been unaccounted for is the useful part of the record.
  it('keeps first_seen_at when an unclaimed state is seen again', async () => {
    await recordDriftReport({ checkedAt: AT, results: [{ stateKey: 'left-behind-o7', outcome: 'clean' }] })
    const later = new Date(AT.getTime() + 86_400_000)
    await recordDriftReport({ checkedAt: later, results: [{ stateKey: 'left-behind-o7', outcome: 'drifted' }] })

    const [row] = await db.select().from(unclaimedStates).where(eq(unclaimedStates.stateKey, 'left-behind-o7'))
    expect(row.firstSeenAt.toISOString()).toBe(AT.toISOString())
    expect(row.lastSeenAt.toISOString()).toBe(later.toISOString())
  })

  it('stops calling a state unclaimed once an element claims it', async () => {
    await recordDriftReport({ checkedAt: AT, results: [{ stateKey: 'web-01-o42', outcome: 'clean' }] })
    expect(await db.select().from(unclaimedStates)).toHaveLength(1)

    // The element is (re)created, so the key is now accounted for.
    await scenario()
    await recordDriftReport({ checkedAt: AT, results: [{ stateKey: 'web-01-o42', outcome: 'clean' }] })

    expect(await db.select().from(unclaimedStates)).toHaveLength(0)
  })

  /*
   * The rule that matters most. A report is CI-supplied input; an element on
   * its way out must not be annotated by a plan that started before the
   * teardown did.
   */
  it.each(['decommissioning', 'decommissioned'] as const)('does not touch a %s element', async (status) => {
    const { element } = await scenario({ status })

    const out = await recordDriftReport({ checkedAt: AT, results: [{ stateKey: 'web-01-o42', outcome: 'drifted' }] })

    const row = await reload(element.id)
    expect(row.lastRefreshedAt).toBeNull()
    expect(row.lastRefreshOutcome).toBeNull()
    // It is not silently dropped either — an unmatched key is an observation.
    expect(out.unclaimed).toBe(1)
  })

  it('never creates or removes an element', async () => {
    const { element } = await scenario()
    const before = await db.select({ id: infrastructureElements.id }).from(infrastructureElements)

    await recordDriftReport({
      checkedAt: AT,
      results: [
        { stateKey: 'web-01-o42', outcome: 'drifted' },
        { stateKey: 'ghost-o99', outcome: 'drifted' },
      ],
    })

    const after = await db.select({ id: infrastructureElements.id }).from(infrastructureElements)
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id))
    expect((await reload(element.id)).status).toBe('active')
  })

  it('matches every key an element owns, not just the first', async () => {
    const { element } = await scenario({ stateKeys: { '1': 'web-01-o42', '2': 'dns-01-o42' } })

    const out = await recordDriftReport({
      checkedAt: AT,
      results: [{ stateKey: 'web-01-o42', outcome: 'clean' }, { stateKey: 'dns-01-o42', outcome: 'drifted' }],
    })

    expect(out.matched).toBe(2)
    expect((await reload(element.id)).lastRefreshOutcome).toBe('drifted')
  })

  it('audits drift, and only drift', async () => {
    await scenario()

    await recordDriftReport({ checkedAt: AT, results: [{ stateKey: 'web-01-o42', outcome: 'clean' }] })
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'infra.drift_detected'))).toHaveLength(0)

    await recordDriftReport({ checkedAt: AT, results: [{ stateKey: 'web-01-o42', outcome: 'drifted' }] })
    // A clean run every fifteen minutes would bury the log, which is how an
    // audit log stops being read.
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'infra.drift_detected'))).toHaveLength(1)
  })

  it('is idempotent — the same report twice leaves the same rows', async () => {
    const { element } = await scenario()
    const report = { checkedAt: AT, results: [{ stateKey: 'web-01-o42', outcome: 'drifted' as const }] }

    await recordDriftReport(report)
    const first = await reload(element.id)
    await recordDriftReport(report)
    const second = await reload(element.id)

    expect(second).toEqual(first)
  })
})

describe('driftReportStatus', () => {
  /*
   * "Reported clean" and "never heard" have to stay distinguishable. If the
   * pipeline stops running, every element quietly stops being updated and
   * nothing anywhere says why — silence must not read as health.
   */
  it('counts active elements nothing has ever reported on', async () => {
    await scenario()
    expect((await driftReportStatus()).neverReported).toBe(1)

    await recordDriftReport({ checkedAt: AT, results: [{ stateKey: 'web-01-o42', outcome: 'clean' }] })

    const status = await driftReportStatus()
    expect(status.neverReported).toBe(0)
    expect(status.lastReportAt?.toISOString()).toBe(AT.toISOString())
    expect(status.elementsReported).toBe(1)
  })

  it('has no last report before one arrives', async () => {
    const [row] = await db.select().from(driftReportState)
    expect(row.lastReportAt).toBeNull()
  })
})

describe('driftTargets', () => {
  /*
   * The work list the reporting pipeline asks for. `plan -refresh-only` needs
   * the template and the variables the apply used; a state file says neither.
   */
  const withStack = async (over: { status?: string; stateKeys?: Record<string, string> } = {}) => {
    const user = await createUser({ email: `targets-${Math.random()}@test.dev` })
    const category = await createCategory()
    const product = await createProduct(category.id)
    const ci = await createCiSource()
    const environment = await createEnvironment(ci.id)
    const project = await createProject(user.id)
    const [stack] = await db
      .insert(pipelineStacks)
      .values({
        productId: product.id,
        environmentId: environment.id,
        name: 'vm-and-dns',
        stateKeyParam: 'hostname',
        steps: [
          { template: 'linode/virtual-machine', stateSuffix: 'vm', execOrder: 0, upstreamRefs: [] },
          { template: 'linode/dns-record', stateSuffix: 'dns', execOrder: 1, upstreamRefs: [] },
        ],
      })
      .returning()
    const order = await createOrder(project.id, product.id, environment.id, user.id, { status: 'completed' })
    const element = await createInfraElement(order.id, project.id, environment.id, product.id, {
      status: over.status ?? 'active',
      parameters: { hostname: 'web-01', admin_password: 'secret' },
      stateKeys: over.stateKeys ?? { [String(stack.id)]: 'web-01-o42' },
    })
    return { element, stack }
  }

  it('gives the pipeline the base state name, the steps and the variables', async () => {
    const { element } = await withStack()

    const [target] = await driftTargets()

    expect(target.elementId).toBe(element.id)
    expect(target.stateName).toBe('web-01-o42')
    // The pipeline appends each step's suffix to the base — the same
    // composition generate_stack.py uses.
    expect(target.stack).toEqual([
      { template: 'linode/virtual-machine', stateSuffix: 'vm' },
      { template: 'linode/dns-record', stateSuffix: 'dns' },
    ])
    expect(target.variables.hostname).toBe('web-01')
  })

  it.each(['decommissioning', 'decommissioned'] as const)('omits a %s element', async (status) => {
    await withStack({ status })
    expect(await driftTargets()).toEqual([])
  })

  /*
   * Elements from before #200 have no recorded key. Recomputing one from
   * today's `stateKeyParam` would address a state file that was never created
   * if an admin has since edited it — the exact bug #200 fixed — so they are
   * omitted rather than guessed at.
   */
  it('omits an element with no recorded state key rather than deriving one', async () => {
    await withStack({ stateKeys: {} })
    expect(await driftTargets()).toEqual([])
  })

  it('omits a state key whose stack has since been deleted', async () => {
    await withStack({ stateKeys: { '999999': 'orphan-o1' } })
    // Its state file still exists, so it surfaces as an unclaimed state on the
    // next report — which is honest, and better than planning it against a guess.
    expect(await driftTargets()).toEqual([])
  })
})
