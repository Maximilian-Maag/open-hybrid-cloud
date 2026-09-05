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
import { loadWindowPolicy, whenMayItDeploy, dueScheduledOrders } from './windowPolicy'

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
