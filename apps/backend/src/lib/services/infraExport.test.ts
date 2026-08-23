import { describe, it, expect } from 'vitest'
import type { SessionUser } from '@open-hybrid-cloud/types'
import { buildInfraExportRows } from './infraExport'
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
  createOrder,
  createInfraElement,
  linkProductEnvironment,
  createCostCenter,
} from '@/test/helpers'

const makeSession = (u: { id: number; email: string; name: string; role: string }): SessionUser =>
  ({ id: u.id, email: u.email, name: u.name, role: u.role as SessionUser['role'] })

const setup = async () => {
  const admin = await createUser({ role: 'admin', email: 'infra-export-admin@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Nginx Gateway')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id, undefined, 'AWS Frankfurt')
  await linkProductEnvironment(product.id, env.id, { price: '10.00' })
  const project = await createProject(admin.id, 'Webshop')
  return { admin, product, env, project }
}

/** One provisioned element, with the order's cost-centre column set or left null. */
const seedElement = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  opts: { orderCostCenterId?: number } = {},
) => {
  const order = await createOrder(ctx.project.id, ctx.product.id, ctx.env.id, ctx.admin.id, {
    status: 'completed',
  })
  if (opts.orderCostCenterId !== undefined) {
    await db
      .update(orders)
      .set({ costCenterId: opts.orderCostCenterId })
      .where(eq(orders.id, order.id))
  }
  return createInfraElement(order.id, ctx.project.id, ctx.env.id, ctx.product.id)
}

describe('buildInfraExportRows — cost centre (issue #189)', () => {
  it("falls through to the project's cost centre for a default-mode order", async () => {
    // `cost_center_mode` DEFAULTS to 'project', and in that mode validateCostCenter
    // deliberately writes null onto the order because attribution follows the
    // project. Joining on the order column alone left this cell blank for most of
    // the inventory, while the cost dashboard for the same period attributed all of
    // it — and this export is the one that reads as the inventory of record.
    const ctx = await setup()
    const cc = await createCostCenter({ code: 'CC-INFRA', name: 'Platform' })
    await db.update(projects).set({ costCenterId: cc.id }).where(eq(projects.id, ctx.project.id))
    await seedElement(ctx)

    const result = await buildInfraExportRows(makeSession(ctx.admin), {})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toHaveLength(1)
    expect(result.data[0].costCenter).toBe('CC-INFRA — Platform')
  })

  it("prefers the order's own cost centre over the project's", async () => {
    // 'select' and 'overhead' mode both pin one onto the order; that choice wins.
    const ctx = await setup()
    const projectCc = await createCostCenter({ code: 'CC-PROJ', name: 'Webshop' })
    const orderCc = await createCostCenter({ code: 'CC-ORDER', name: 'Chosen' })
    await db
      .update(projects)
      .set({ costCenterId: projectCc.id })
      .where(eq(projects.id, ctx.project.id))
    await seedElement(ctx, { orderCostCenterId: orderCc.id })

    const result = await buildInfraExportRows(makeSession(ctx.admin), {})
    expect(result.ok && result.data[0].costCenter).toBe('CC-ORDER — Chosen')
  })

  it('leaves the cell empty when neither the order nor the project has one', async () => {
    // Genuinely unattributed. Empty rather than an invented label.
    const ctx = await setup()
    await seedElement(ctx)

    const result = await buildInfraExportRows(makeSession(ctx.admin), {})
    expect(result.ok && result.data[0].costCenter).toBe('')
  })
})
