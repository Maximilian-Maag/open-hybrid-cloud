import { describe, it, expect } from 'vitest'
import { db } from '@/lib/db/client'
import { orders, projects } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder as seedOrder,
  createCostCenter,
} from '@/test/helpers'
import { getCostCentersForInfra } from './infraCostCenters'

/**
 * The cost-centre column of the infrastructure export (#189).
 *
 * `cost_center_mode` DEFAULTS to 'project', and in that mode `validateCostCenter`
 * deliberately writes NULL onto the order, because the spend belongs to the
 * project. So reading only `orders.cost_center_id` leaves this column blank for
 * the majority of real elements — while the element's own detail page and both
 * cost reports resolve the fall-through and show one. Two reports of the same
 * period disagreeing, with the export looking like the inventory of record.
 */

async function orderIn(opts: { orderCc?: number | null; projectCc?: number | null }) {
  const owner = await createUser({ role: 'root' })
  const cat = await createCategory()
  const product = await createProduct(cat.id)
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const project = await createProject(owner.id)
  if (opts.projectCc !== undefined) {
    await db.update(projects).set({ costCenterId: opts.projectCc }).where(eq(projects.id, project.id))
  }
  const order = await seedOrder(project.id, product.id, env.id, owner.id)
  if (opts.orderCc !== undefined) {
    await db.update(orders).set({ costCenterId: opts.orderCc }).where(eq(orders.id, order.id))
  }
  return order
}

describe('getCostCentersForInfra', () => {
  it("uses the order's own cost centre when it has one", async () => {
    const cc = await createCostCenter({ code: 'SEL-1', name: 'Chosen By Orderer' })
    const order = await orderIn({ orderCc: cc.id })

    const map = await getCostCentersForInfra([order.id])

    expect(map.get(order.id)).toBe('SEL-1 — Chosen By Orderer')
  })

  // The regression. This is the DEFAULT mode, so it is most of the estate.
  it("falls through to the project's cost centre in the default mode", async () => {
    const cc = await createCostCenter({ code: 'PRJ-1', name: 'Project Account' })
    const order = await orderIn({ orderCc: null, projectCc: cc.id })

    const map = await getCostCentersForInfra([order.id])

    expect(map.get(order.id)).toBe('PRJ-1 — Project Account')
  })

  // Fall-through, not merge: an order that names its own account overrides the
  // project's, which is the whole point of 'select' and 'overhead' mode.
  it("prefers the order's cost centre over the project's", async () => {
    const orderCc = await createCostCenter({ code: 'ORD-1', name: 'Order Account' })
    const projectCc = await createCostCenter({ code: 'PRJ-2', name: 'Project Account' })
    const order = await orderIn({ orderCc: orderCc.id, projectCc: projectCc.id })

    const map = await getCostCentersForInfra([order.id])

    expect(map.get(order.id)).toBe('ORD-1 — Order Account')
  })

  // Blank is still a legitimate answer — but only when neither has one.
  it('answers nothing when neither the order nor the project has one', async () => {
    const order = await orderIn({ orderCc: null, projectCc: null })

    const map = await getCostCentersForInfra([order.id])

    expect(map.has(order.id)).toBe(false)
  })

  it('resolves a batch, one entry per order', async () => {
    const a = await createCostCenter({ code: 'A-1', name: 'Alpha' })
    const b = await createCostCenter({ code: 'B-1', name: 'Beta' })
    const viaOrder = await orderIn({ orderCc: a.id })
    const viaProject = await orderIn({ orderCc: null, projectCc: b.id })
    const neither = await orderIn({ orderCc: null, projectCc: null })

    const map = await getCostCentersForInfra([viaOrder.id, viaProject.id, neither.id])

    expect(map.get(viaOrder.id)).toBe('A-1 — Alpha')
    expect(map.get(viaProject.id)).toBe('B-1 — Beta')
    expect(map.size).toBe(2)
  })

  it('asks nothing of the database for an empty batch', async () => {
    expect((await getCostCentersForInfra([])).size).toBe(0)
  })

  it('deduplicates repeated order ids', async () => {
    const cc = await createCostCenter({ code: 'D-1', name: 'Delta' })
    const order = await orderIn({ orderCc: cc.id })

    const map = await getCostCentersForInfra([order.id, order.id, order.id])

    expect(map.size).toBe(1)
  })

  /*
   * #158. postgres.js binds one parameter per element of an `IN (...)`, and the
   * wire protocol allows 65,535 in a statement — so a single list past that
   * does not run slowly, it fails outright, and the export it belongs to fails
   * with it.
   *
   * 70,000 ids, which is over that line and under it once chunked. Almost none
   * of them exist, and that is fine: what is being exercised is the statement
   * being sent at all. Before the chunking this call raised rather than
   * returning a small map.
   */
  it('survives more ids than one statement may bind', async () => {
    const cc = await createCostCenter({ code: 'E-1', name: 'Epsilon' })
    const order = await orderIn({ orderCc: cc.id })

    const padding = Array.from({ length: 70_000 }, (_, i) => order.id + i + 1)
    const map = await getCostCentersForInfra([order.id, ...padding])

    expect(map.get(order.id)).toBe('E-1 — Epsilon')
  }, 60_000)
})
