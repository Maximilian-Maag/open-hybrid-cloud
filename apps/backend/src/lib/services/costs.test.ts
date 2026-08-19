import { describe, it, expect } from 'vitest'
import type { SessionUser } from '@open-hybrid-cloud/types'
import { getCostReport, getCostRows, assertMaySeeProject } from './costs'
import { db } from '@/lib/db/client'
import { orders, exchangeRates, productEnvironments, projects } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { ProductSnapshot } from './snapshot'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder as seedOrder,
  createInfraElement,
  linkProductEnvironment,
  createCostCenter,
} from '@/test/helpers'

const makeSession = (u: { id: number; email: string; name: string; role: string }): SessionUser =>
  ({ id: u.id, email: u.email, name: u.name, role: u.role as SessionUser['role'] })

const snapshot = (price: string, currency = 'EUR'): ProductSnapshot => ({
  version: 1,
  capturedAt: '2026-06-01T00:00:00.000Z',
  productName: 'Snapshotted',
  productDescription: '',
  environmentName: 'Env',
  price,
  currency,
  costCenterMode: 'project',
  forcedCostCenter: false,
  trialEnabled: false,
  trialDurationMinutes: 30,
  parameters: [],
})

const setup = async () => {
  const admin = await createUser({ role: 'admin', email: 'cost-admin@test.dev', name: 'Admin' })
  const pm = await createUser({ role: 'project_manager', email: 'cost-pm@test.dev', name: 'PM' })
  const otherPm = await createUser({ role: 'project_manager', email: 'cost-other@test.dev', name: 'Other' })
  const cat = await createCategory()
  const nginx = await createProduct(cat.id, 'Nginx Gateway')
  const postgres = await createProduct(cat.id, 'Managed Postgres')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id, undefined, 'AWS Frankfurt')
  await linkProductEnvironment(nginx.id, env.id, { price: '10.00' })
  await linkProductEnvironment(postgres.id, env.id, { price: '20.00' })
  const mine = await createProject(pm.id, 'Webshop')
  const theirs = await createProject(otherPm.id, 'Hidden')
  return { admin, pm, otherPm, nginx, postgres, env, mine, theirs }
}

/** Seed an order with a snapshot price, so the report reads the historical value. */
const spend = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  opts: {
    projectId: number
    productId: number
    price: string
    currency?: string
    status?: string
    createdAt?: Date
    costCenterId?: number
    noSnapshot?: boolean
  },
) => {
  const order = await seedOrder(opts.projectId, opts.productId, ctx.env.id, ctx.pm.id, {
    status: opts.status ?? 'completed',
  })
  const patch = {
    ...(opts.noSnapshot ? {} : { productSnapshot: snapshot(opts.price, opts.currency) }),
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    ...(opts.costCenterId ? { costCenterId: opts.costCenterId } : {}),
  }
  // Drizzle rejects an empty `.set({})`, which is exactly the pre-snapshot case
  // where the seeded row already says everything it needs to.
  if (Object.keys(patch).length > 0) {
    await db.update(orders).set(patch).where(eq(orders.id, order.id))
  }
  return order
}

describe('getCostReport — what counts as spend', () => {
  it('counts provisioning and completed orders', async () => {
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '10.00', status: 'completed' })
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '5.00', status: 'provisioning' })

    const result = await getCostReport(makeSession(ctx.admin))
    expect(result.ok && result.data.totalEur).toBe(15)
    expect(result.ok && result.data.orderCount).toBe(2)
  })

  it.each(['pending', 'rejected', 'failed'])('excludes a %s order', async (status) => {
    // A rejected or failed order never delivered infrastructure; counting it would
    // inflate every figure on the page.
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '99.00', status })

    const result = await getCostReport(makeSession(ctx.admin))
    expect(result.ok && result.data.totalEur).toBe(0)
    expect(result.ok && result.data.orderCount).toBe(0)
  })

  it('counts an order once even with several infrastructure rows', async () => {
    const ctx = await setup()
    const order = await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '10.00' })
    await createInfraElement(order.id, ctx.mine.id, ctx.env.id, ctx.nginx.id)
    await createInfraElement(order.id, ctx.mine.id, ctx.env.id, ctx.nginx.id)

    const result = await getCostReport(makeSession(ctx.admin))
    expect(result.ok && result.data.totalEur).toBe(10)
    expect(result.ok && result.data.orderCount).toBe(1)
  })
})

describe('getCostReport — which price', () => {
  it('uses the snapshot price, not the current one', async () => {
    // This is the whole reason snapshots exist: an admin editing a price must not
    // silently restate last quarter's spend.
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '10.00' })
    await db
      .update(productEnvironments)
      .set({ price: '999.00' })
      .where(eq(productEnvironments.productId, ctx.nginx.id))

    const result = await getCostReport(makeSession(ctx.admin))
    expect(result.ok && result.data.totalEur).toBe(10)
    expect(result.ok && result.data.estimatedOrders).toBe(0)
  })

  it('falls back to the live price for a pre-snapshot order and flags it', async () => {
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: 'ignored', noSnapshot: true })

    const result = await getCostReport(makeSession(ctx.admin))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.totalEur).toBe(10)
    // Flagged, so the total is not presented as exact when part of it is inferred.
    expect(result.data.estimatedOrders).toBe(1)
  })

  it('keeps an order whose offering was withdrawn', async () => {
    // Past spend must not disappear because the product is no longer sold.
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '10.00' })
    await db.delete(productEnvironments).where(eq(productEnvironments.productId, ctx.nginx.id))

    const result = await getCostReport(makeSession(ctx.admin))
    expect(result.ok && result.data.totalEur).toBe(10)
    expect(result.ok && result.data.orderCount).toBe(1)
  })

  it('treats an unparseable price as zero rather than NaN', async () => {
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: 'twelve' })

    const result = await getCostReport(makeSession(ctx.admin))
    // NaN would poison every total it touched.
    expect(result.ok && result.data.totalEur).toBe(0)
    expect(result.ok && result.data.orderCount).toBe(1)
  })
})

describe('getCostReport — currency conversion', () => {
  it('converts a foreign currency to EUR using the stored rate', async () => {
    const ctx = await setup()
    await db.insert(exchangeRates).values({ currencyCode: 'CHF', rate: '2.0' })
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '20.00', currency: 'CHF' })

    const result = await getCostReport(makeSession(ctx.admin))
    // Rates are relative to EUR, so 20 CHF at 2.0 is 10 EUR.
    expect(result.ok && result.data.totalEur).toBe(10)
  })

  it('reports an unconvertible currency instead of counting it as EUR', async () => {
    // Treating it as EUR would misstate the total by the exchange rate.
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '100.00', currency: 'JPY' })

    const result = await getCostReport(makeSession(ctx.admin))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.totalEur).toBe(0)
    expect(result.data.unconverted).toEqual([{ currency: 'JPY', amount: 100 }])
  })

  it('sums several orders in the same unconvertible currency', async () => {
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '100.00', currency: 'JPY' })
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.postgres.id, price: '50.00', currency: 'JPY' })

    const result = await getCostReport(makeSession(ctx.admin))
    expect(result.ok && result.data.unconverted).toEqual([{ currency: 'JPY', amount: 150 }])
  })

  it('rounds to two decimals', async () => {
    const ctx = await setup()
    await db.insert(exchangeRates).values({ currencyCode: 'CHF', rate: '3.0' })
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '10.00', currency: 'CHF' })

    const result = await getCostReport(makeSession(ctx.admin))
    expect(result.ok && result.data.totalEur).toBe(3.33)
  })
})

describe('getCostReport — breakdowns', () => {
  it('groups by project, product, environment and cost centre', async () => {
    const ctx = await setup()
    const cc = await createCostCenter({ code: 'CC-1', name: 'Platform' })
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '10.00', costCenterId: cc.id })
    await spend(ctx, { projectId: ctx.theirs.id, productId: ctx.postgres.id, price: '30.00' })

    const result = await getCostReport(makeSession(ctx.admin))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Largest spend first — the point of the page is to see where money goes.
    expect(result.data.byProject.map((b) => [b.label, b.totalEur])).toEqual([
      ['Hidden', 30],
      ['Webshop', 10],
    ])
    expect(result.data.byProduct.map((b) => b.label)).toEqual(['Managed Postgres', 'Nginx Gateway'])
    expect(result.data.byEnvironment).toMatchObject([{ label: 'AWS Frankfurt', totalEur: 40 }])
    expect(result.data.byCostCenter.map((b) => [b.label, b.totalEur])).toEqual([
      // Orders in 'project' cost-centre mode carry none, and are labelled rather
      // than dropped from the breakdown.
      ['No cost centre', 30],
      ['CC-1 — Platform', 10],
    ])
  })

  it("attributes a 'project'-mode order to its project's cost centre", async () => {
    // 'project' is the DEFAULT cost-centre mode and stores nothing on the order,
    // because attribution follows the project. Reading only the order-level column
    // filed every such order under "No cost centre", which emptied the breakdown
    // for most catalogues.
    const ctx = await setup()
    const cc = await createCostCenter({ code: 'CC-9', name: 'Owning Team' })
    await db.update(projects).set({ costCenterId: cc.id }).where(eq(projects.id, ctx.mine.id))
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '40.00' })

    const result = await getCostReport(makeSession(ctx.admin))
    expect(result.ok && result.data.byCostCenter).toEqual([
      { id: cc.id, label: 'CC-9 — Owning Team', totalEur: 40, orderCount: 1 },
    ])
  })

  it("prefers the order's own cost centre over the project's", async () => {
    // 'select' and 'overhead' mode DO store one, and that choice is the specific
    // one — it must not be overridden by the project's default.
    const ctx = await setup()
    const projectCc = await createCostCenter({ code: 'CC-P', name: 'Project Default' })
    const orderCc = await createCostCenter({ code: 'CC-O', name: 'Chosen' })
    await db.update(projects).set({ costCenterId: projectCc.id }).where(eq(projects.id, ctx.mine.id))
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '15.00', costCenterId: orderCc.id })

    const result = await getCostReport(makeSession(ctx.admin))
    expect(result.ok && result.data.byCostCenter.map((b) => b.label)).toEqual(['CC-O — Chosen'])
  })

  it('still reports an order as unattributed when its project has no cost centre', async () => {
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '5.00' })

    const result = await getCostReport(makeSession(ctx.admin))
    expect(result.ok && result.data.byCostCenter).toEqual([
      { id: null, label: 'No cost centre', totalEur: 5, orderCount: 1 },
    ])
  })

  it('counts orders per bucket', async () => {
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '10.00' })
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '10.00' })

    const result = await getCostReport(makeSession(ctx.admin))
    expect(result.ok && result.data.byProject[0]).toMatchObject({ orderCount: 2, totalEur: 20 })
  })
})

describe('getCostReport — scoping', () => {
  it('shows an admin every project and marks the report global', async () => {
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '10.00' })
    await spend(ctx, { projectId: ctx.theirs.id, productId: ctx.nginx.id, price: '20.00' })

    const result = await getCostReport(makeSession(ctx.admin))
    expect(result.ok && result.data.totalEur).toBe(30)
    expect(result.ok && result.data.global).toBe(true)
  })

  it('scopes a project manager to the projects they OWN', async () => {
    // Cost is a property of the project they are accountable for — an order somebody
    // else placed into it still spends their budget.
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '10.00' })
    await spend(ctx, { projectId: ctx.theirs.id, productId: ctx.nginx.id, price: '20.00' })

    const result = await getCostReport(makeSession(ctx.pm))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.totalEur).toBe(10)
    expect(result.data.byProject.map((b) => b.label)).toEqual(['Webshop'])
    expect(result.data.global).toBe(false)
  })

  it('narrows to one project when asked', async () => {
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '10.00' })
    await spend(ctx, { projectId: ctx.theirs.id, productId: ctx.nginx.id, price: '20.00' })

    const result = await getCostReport(makeSession(ctx.admin), { projectId: ctx.theirs.id })
    expect(result.ok && result.data.totalEur).toBe(20)
  })
})

describe('getCostReport — time range', () => {
  it('includes only orders inside the range, both bounds inclusive', async () => {
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '10.00', createdAt: new Date('2026-01-15T00:00:00.000Z') })
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '20.00', createdAt: new Date('2026-06-15T00:00:00.000Z') })

    const result = await getCostReport(makeSession(ctx.admin), {
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-06-30T23:59:59.999Z'),
    })
    expect(result.ok && result.data.totalEur).toBe(20)

    const onBoundary = await getCostReport(makeSession(ctx.admin), {
      from: new Date('2026-01-15T00:00:00.000Z'),
      to: new Date('2026-01-15T00:00:00.000Z'),
    })
    expect(onBoundary.ok && onBoundary.data.totalEur).toBe(10)
  })

  it('returns a zero report rather than an error when nothing matches', async () => {
    const ctx = await setup()
    const result = await getCostReport(makeSession(ctx.admin), { from: new Date('2099-01-01T00:00:00.000Z') })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toMatchObject({ totalEur: 0, orderCount: 0, byProject: [], unconverted: [] })
    }
  })
})

describe('getCostRows', () => {
  it('returns one reconcilable row per counted order, newest first', async () => {
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '10.00', createdAt: new Date('2026-01-01T00:00:00.000Z') })
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.postgres.id, price: '20.00', createdAt: new Date('2026-06-01T00:00:00.000Z') })

    const result = await getCostRows(makeSession(ctx.admin))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.map((r) => r.price)).toEqual(['20.00', '10.00'])
    expect(result.data[0]).toMatchObject({
      projectName: 'Webshop',
      productName: 'Managed Postgres',
      environmentName: 'AWS Frankfurt',
      currency: 'EUR',
      priceEur: 20,
      estimated: false,
    })
  })

  it('marks a pre-snapshot row as estimated', async () => {
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: 'x', noSnapshot: true })

    const result = await getCostRows(makeSession(ctx.admin))
    expect(result.ok && result.data[0].estimated).toBe(true)
  })

  it('leaves priceEur null when the currency has no rate', async () => {
    // Null, not 0 — zero would read as "free" in the export.
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '100.00', currency: 'JPY' })

    const result = await getCostRows(makeSession(ctx.admin))
    expect(result.ok && result.data[0].priceEur).toBeNull()
  })

  it('scopes a project manager the same way the report does', async () => {
    const ctx = await setup()
    await spend(ctx, { projectId: ctx.mine.id, productId: ctx.nginx.id, price: '10.00' })
    await spend(ctx, { projectId: ctx.theirs.id, productId: ctx.nginx.id, price: '20.00' })

    const result = await getCostRows(makeSession(ctx.pm))
    expect(result.ok && result.data).toHaveLength(1)
    expect(result.ok && result.data[0].projectName).toBe('Webshop')
  })
})

describe('assertMaySeeProject', () => {
  it('lets an admin see any project', async () => {
    const ctx = await setup()
    expect((await assertMaySeeProject(makeSession(ctx.admin), ctx.theirs.id)).ok).toBe(true)
  })

  it('lets a PM see their own', async () => {
    const ctx = await setup()
    expect((await assertMaySeeProject(makeSession(ctx.pm), ctx.mine.id)).ok).toBe(true)
  })

  it('refuses a PM another project, rather than returning an empty report', async () => {
    // An empty report reads as "no spend" instead of "not yours".
    const ctx = await setup()
    const result = await assertMaySeeProject(makeSession(ctx.pm), ctx.theirs.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('returns 404 for an unknown project', async () => {
    const ctx = await setup()
    const result = await assertMaySeeProject(makeSession(ctx.pm), 999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })
})
