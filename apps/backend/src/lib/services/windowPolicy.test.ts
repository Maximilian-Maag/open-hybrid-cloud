import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  appConfig, deploymentEnvironments, deploymentWindows, holidays, orders,
} from '@/lib/db/schema'
import {
  createUser, createCategory, createProduct, createCiSource,
  createEnvironment, createProject, createOrder,
} from '@/test/helpers'
import {
  loadWindowPolicy, whenMayItDeploy, dueScheduledOrders, releaseDueScheduledOrders,
  deployScheduledOrderNow,
} from './windowPolicy'
import type * as OrdersService from '@/lib/services/orders'
import type * as AuditModule from '@/lib/audit'
import { logAudit } from '@/lib/audit'
import { provisionOrderElements } from '@/lib/services/orders'

vi.mock('@/lib/services/orders', async (importOriginal) => ({
  ...(await importOriginal<typeof OrdersService>()),
  provisionOrderElements: vi.fn(),
}))
vi.mock('@/lib/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof AuditModule>()),
  logAudit: vi.fn(),
}))

/**
 * Reading the window policy out of the database, and deciding with it (#330).
 *
 * The arithmetic itself is tested next door without a database. What is only
 * testable here is the wiring: which switches have to be on, and what happens
 * when a deployment turns one on and forgets the other.
 */
const BERLIN = 'Europe/Berlin'

const setup = async (over: { respects?: boolean; windows?: { startMinute: number; durationMinutes: number }[] } = {}) => {
  const user = await createUser({ email: `win-${Math.random()}@test.dev` })
  const category = await createCategory()
  const product = await createProduct(category.id)
  const ci = await createCiSource()
  const environment = await createEnvironment(ci.id)
  const project = await createProject(user.id)

  await db.update(appConfig).set({ deploymentTimeZone: BERLIN }).where(eq(appConfig.id, 1))
  await db
    .update(deploymentEnvironments)
    .set({ respectsDeploymentWindows: over.respects ?? true })
    .where(eq(deploymentEnvironments.id, environment.id))
  for (const w of over.windows ?? [{ startMinute: 8 * 60, durationMinutes: 120 }]) {
    await db.insert(deploymentWindows).values(w)
  }
  return { user, product, environment, project }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('loadWindowPolicy', () => {
  it('reads the zone, the windows and only the observed holidays', async () => {
    await setup()
    await db.insert(holidays).values([
      { date: '2026-10-05', name: 'Observed', source: 'feed', observed: true },
      // A holiday the company works through — recorded, not applied.
      { date: '2026-10-06', name: 'Not observed here', source: 'manual', observed: false },
    ])

    const policy = await loadWindowPolicy()

    expect(policy.timeZone).toBe(BERLIN)
    expect(policy.windows).toEqual([{ startMinute: 480, durationMinutes: 120 }])
    expect([...policy.holidays]).toEqual(['2026-10-05'])
  })
})

describe('whenMayItDeploy', () => {
  // Wednesday 2026-09-02. Berlin is UTC+2, so 06:00Z is 08:00 local.
  const INSIDE = new Date('2026-09-02T07:00:00Z')
  const OUTSIDE = new Date('2026-09-02T20:00:00Z')

  it('does not wait inside a window', async () => {
    const { environment } = await setup()
    expect(await whenMayItDeploy(environment.id, INSIDE)).toBeNull()
  })

  it('waits for the next window outside one', async () => {
    const { environment } = await setup()
    const wait = await whenMayItDeploy(environment.id, OUTSIDE)
    // 22:00 Wednesday Berlin -> 08:00 Thursday.
    expect(wait?.scheduledFor.toISOString()).toBe('2026-09-03T06:00:00.000Z')
  })

  /*
   * The default that makes the upgrade safe. An environment that never opted in
   * behaves exactly as it did before this feature existed, whatever the hour.
   */
  it('does not wait for an environment that has not opted in', async () => {
    const { environment } = await setup({ respects: false })
    expect(await whenMayItDeploy(environment.id, OUTSIDE)).toBeNull()
  })

  /*
   * Two switches, and this is the second. A deployment that turned the flag on
   * and defined no windows would otherwise queue every order for ever — a worse
   * failure than not having the feature at all.
   */
  it('does not wait when the flag is on but no window is configured', async () => {
    const { environment } = await setup({ windows: [] })
    expect(await whenMayItDeploy(environment.id, OUTSIDE)).toBeNull()
  })

  // Every day excluded means the configuration can never open. Provisioning now
  // is the lesser wrong: the alternative is an order waiting for ever with
  // nothing to tell its requester.
  it('does not wait when no window can ever open', async () => {
    const { environment } = await setup()
    const rows = Array.from({ length: 400 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 8, 2) + i * 86_400_000)
      return { date: d.toISOString().slice(0, 10), name: 'Shutdown', source: 'manual' as const, observed: true }
    })
    await db.insert(holidays).values(rows)

    expect(await whenMayItDeploy(environment.id, OUTSIDE)).toBeNull()
  })

  it('is null for an environment that does not exist, rather than throwing', async () => {
    await setup()
    expect(await whenMayItDeploy(999_999, OUTSIDE)).toBeNull()
  })
})

describe('dueScheduledOrders', () => {
  const scheduleOne = async (at: Date, status: 'scheduled' | 'pending' = 'scheduled') => {
    const { user, product, environment, project } = await setup()
    const order = await createOrder(project.id, product.id, environment.id, user.id, { status })
    await db.update(orders).set({ status, scheduledFor: at }).where(eq(orders.id, order.id))
    return order
  }

  it('returns an order whose window has opened', async () => {
    const order = await scheduleOne(new Date('2026-09-03T06:00:00Z'))
    expect(await dueScheduledOrders(new Date('2026-09-03T06:00:01Z'))).toEqual([order.id])
  })

  it('does not return one whose window has not opened yet', async () => {
    await scheduleOne(new Date('2026-09-03T06:00:00Z'))
    expect(await dueScheduledOrders(new Date('2026-09-03T05:59:00Z'))).toEqual([])
  })

  /*
   * A pending order with a release time is not something the sweep should
   * provision behind an approver's back — and the database will not let one
   * exist. `orders_scheduled_consistency` is what stops it, so the honest
   * assertion is on the constraint rather than on the query filtering a row it
   * can never see. (This test was written the other way first, and the insert
   * failed — which is the constraint doing its job.)
   */
  it('cannot even store a release time on an order that is not scheduled', async () => {
    const { user, product, environment, project } = await setup()
    const order = await createOrder(project.id, product.id, environment.id, user.id, { status: 'pending' })

    let thrown: unknown
    try {
      await db.update(orders).set({ scheduledFor: new Date('2026-09-03T06:00:00Z') }).where(eq(orders.id, order.id))
    } catch (e) {
      thrown = e
    }

    // Drizzle wraps the driver error, so the constraint name is on the cause
    // rather than the message — asserting on the message alone would pass for
    // any failed query at all, including a typo in the column name.
    expect(thrown).toBeInstanceOf(Error)
    const cause = (thrown as { cause?: { constraint_name?: string } }).cause
    expect(cause?.constraint_name).toBe('orders_scheduled_consistency')
  })

  /*
   * `scheduled_for` is NOT cleared when an order is released — it is the record
   * of which window let it through. So the status filter is the only thing
   * stopping the sweep picking a released order up again and provisioning it
   * twice, and a mutant that dropped it passed everything until this existed.
   */
  it('does not return an order it has already released', async () => {
    const { user, product, environment, project } = await setup()
    const order = await createOrder(project.id, product.id, environment.id, user.id, { status: 'pending' })
    await db
      .update(orders)
      .set({ status: 'scheduled', scheduledFor: new Date('2026-09-03T06:00:00Z') })
      .where(eq(orders.id, order.id))

    const now = new Date('2026-09-04T00:00:00Z')
    expect(await dueScheduledOrders(now)).toEqual([order.id])

    // Released — the timestamp stays, the status moves.
    await db.update(orders).set({ status: 'provisioning' }).where(eq(orders.id, order.id))

    expect(await dueScheduledOrders(now)).toEqual([])
  })

  it('returns the longest-waiting first', async () => {
    const later = await scheduleOne(new Date('2026-09-03T10:00:00Z'))
    const earlier = await scheduleOne(new Date('2026-09-03T06:00:00Z'))
    expect(await dueScheduledOrders(new Date('2026-09-04T00:00:00Z'))).toEqual([earlier.id, later.id])
  })
})

/*
 * Releasing what the window has made due (#330).
 *
 * The sweep retries by itself, unlike the approval path where a human decides.
 * That is the whole difficulty: every failure has to answer "is it safe to run
 * this order again?", and getting it wrong deploys the same infrastructure
 * twice.
 */
describe('releaseDueScheduledOrders', () => {
  const AT = new Date('2026-09-02T07:00:00Z')

  const dueOrder = async () => {
    const { user, product, environment, project } = await setup()
    const order = await createOrder(project.id, product.id, environment.id, user.id, { status: 'pending' })
    await db
      .update(orders)
      .set({ status: 'scheduled', scheduledFor: new Date(AT.getTime() - 60_000) })
      .where(eq(orders.id, order.id))
    return order
  }

  const reload = async (id: number) => (await db.select().from(orders).where(eq(orders.id, id)))[0]

  beforeEach(() => {
    vi.mocked(provisionOrderElements).mockReset()
    vi.mocked(logAudit).mockReset()
    vi.mocked(provisionOrderElements).mockResolvedValue({ elementIds: [1], pipelineIds: ['p1'], failures: [] } as never)
    vi.mocked(logAudit).mockResolvedValue(undefined as never)
  })

  it('provisions a due order and leaves it provisioning', async () => {
    const order = await dueOrder()

    const out = await releaseDueScheduledOrders(AT)

    expect(out.released).toEqual([order.id])
    expect((await reload(order.id)).status).toBe('provisioning')
  })

  /*
   * Nothing started, so running it again is exactly what should happen:
   * `provisionOrderElements` throws only when not one pipeline started, and it
   * removes the element rows it inserted on the way out.
   */
  it('reschedules an order whose provisioning started nothing', async () => {
    const order = await dueOrder()
    vi.mocked(provisionOrderElements).mockRejectedValue(new Error('CI unreachable'))

    const out = await releaseDueScheduledOrders(AT)

    expect(out.released).toEqual([])
    expect(out.failed[0].reason).toContain('CI unreachable')
    const row = await reload(order.id)
    expect(row.status).toBe('scheduled')
    // Still due, so the next sweep picks it up.
    expect(row.scheduledFor).not.toBeNull()
  })

  /*
   * The bug this guard exists for. A throw from the bracket that CLOSES the run
   * arrives with pipelines already running; rescheduling would deploy the same
   * infrastructure a second time.
   */
  it('does not reschedule an order whose pipelines had already started', async () => {
    const order = await dueOrder()
    vi.mocked(provisionOrderElements).mockImplementation(async () => {
      await db.update(orders).set({ pipelineId: ['pipe-1'] }).where(eq(orders.id, order.id))
      throw new Error('finishOrderTriggerRun exploded')
    })

    const out = await releaseDueScheduledOrders(AT)

    expect(out.released).toEqual([])
    expect(out.failed[0].reason).toContain('deploy the same infrastructure twice')
    expect((await reload(order.id)).status).toBe('provisioning')
  })

  /*
   * Losing the audit line is bad; duplicating the infrastructure because of it
   * is worse. The audit write used to sit inside the recovery, so a failure
   * there put a successfully provisioned order back to 'scheduled' with its
   * `scheduled_for` still due.
   */
  it('keeps a provisioned order provisioned when its audit entry fails', async () => {
    const order = await dueOrder()
    vi.mocked(logAudit).mockRejectedValue(new Error('audit table is on fire'))

    const out = await releaseDueScheduledOrders(AT)

    expect(out.released).toEqual([order.id])
    expect((await reload(order.id)).status).toBe('provisioning')
  })

  it('leaves an order alone once something else has claimed it', async () => {
    const order = await dueOrder()
    await db.update(orders).set({ status: 'provisioning' }).where(eq(orders.id, order.id))

    const out = await releaseDueScheduledOrders(AT)

    expect(out.released).toEqual([])
    expect(vi.mocked(provisionOrderElements)).not.toHaveBeenCalled()
  })
})

/*
 * Root deploying a scheduled order early (#330).
 *
 * #330 shipped the `scheduled` state with no way out of it but the sweep. This
 * is the way out, and it is the one place where the guarantee the feature makes
 * is deliberately stepped over — so what it records matters as much as what it
 * does.
 */
describe('deployScheduledOrderNow', () => {
  const AT = new Date('2026-09-02T20:00:00Z')
  const ROOT = { id: 0, email: 'root@test.dev' }

  const scheduledOrder = async () => {
    const { user, product, environment, project } = await setup()
    const order = await createOrder(project.id, product.id, environment.id, user.id, { status: 'pending' })
    await db
      .update(orders)
      .set({ status: 'scheduled', scheduledFor: new Date('2026-09-03T06:00:00Z') })
      .where(eq(orders.id, order.id))
    return { order, actor: { ...ROOT, id: user.id } }
  }

  const reload = async (id: number) => (await db.select().from(orders).where(eq(orders.id, id)))[0]

  beforeEach(() => {
    vi.mocked(provisionOrderElements).mockReset()
    vi.mocked(logAudit).mockReset()
    vi.mocked(provisionOrderElements).mockResolvedValue({ elementIds: [1], pipelineIds: ['p1'], failures: [] } as never)
    vi.mocked(logAudit).mockResolvedValue(undefined as never)
  })

  it('provisions the order and records who overrode the window', async () => {
    const { order, actor } = await scheduledOrder()

    expect(await deployScheduledOrderNow(order.id, actor, AT)).toEqual({ ok: true })

    const row = await reload(order.id)
    expect(row.status).toBe('provisioning')
    expect(row.windowOverrideBy).toBe(actor.id)
    expect(row.windowOverrideAt?.toISOString()).toBe(AT.toISOString())
    // Left in place on purpose: it says which window this order was waiting
    // for, which is the context that makes the override legible later.
    expect(row.scheduledFor).not.toBeNull()
  })

  it('audits the override before provisioning, naming who and what was due', async () => {
    const { order, actor } = await scheduledOrder()

    await deployScheduledOrderNow(order.id, actor, AT)

    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      actor.id,
      'order.window_overridden',
      order.id,
      expect.stringContaining('without waiting for its window'),
    )
  })

  /*
   * The decision to step over the guardrail was made whether or not CI then
   * answered. An override recorded only on success would leave the least
   * explicable case — forced out of hours, and it broke — with no audit entry.
   */
  it('records the override even when provisioning fails', async () => {
    const { order, actor } = await scheduledOrder()
    vi.mocked(provisionOrderElements).mockRejectedValue(new Error('CI unreachable'))

    const outcome = await deployScheduledOrderNow(order.id, actor, AT)

    expect(outcome).toMatchObject({ ok: false, status: 502 })
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      actor.id,
      'order.window_overridden',
      order.id,
      expect.any(String),
    )
    const row = await reload(order.id)
    expect(row.status, 'nothing started, so it goes back in the queue').toBe('scheduled')
    expect(row.windowOverrideBy).toBe(actor.id)
  })

  /*
   * The trap a human being present does NOT remove. Putting the order back to
   * 'scheduled' with `scheduled_for` still due hands it to the sweep, which
   * would deploy the same infrastructure again hours later with nobody watching.
   */
  it('leaves the order provisioning when its pipelines had already started', async () => {
    const { order, actor } = await scheduledOrder()
    vi.mocked(provisionOrderElements).mockImplementation(async () => {
      await db.update(orders).set({ pipelineId: ['pipe-1'] }).where(eq(orders.id, order.id))
      throw new Error('finishOrderTriggerRun exploded')
    })

    const outcome = await deployScheduledOrderNow(order.id, actor, AT)

    expect(outcome).toMatchObject({ ok: false })
    if (outcome.ok) return
    expect(outcome.message).toContain('deploy the same infrastructure twice')
    expect((await reload(order.id)).status).toBe('provisioning')
  })

  /*
   * Root pressing "Deploy now" at 07:59 while the 08:00 sweep fires must
   * provision the order once. The claim is what settles it, so whoever loses
   * has to be told something true.
   */
  it('refuses an order the sweep has already claimed', async () => {
    const { order, actor } = await scheduledOrder()
    await db.update(orders).set({ status: 'provisioning' }).where(eq(orders.id, order.id))

    const outcome = await deployScheduledOrderNow(order.id, actor, AT)

    expect(outcome).toMatchObject({ ok: false, status: 400 })
    if (!outcome.ok) expect(outcome.message).toContain('provisioning')
    expect(vi.mocked(provisionOrderElements)).not.toHaveBeenCalled()
  })

  it('is a 404 for an order that does not exist', async () => {
    expect(await deployScheduledOrderNow(999_999, ROOT, AT)).toMatchObject({ ok: false, status: 404 })
  })
})
