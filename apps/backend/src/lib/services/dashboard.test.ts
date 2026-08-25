import { describe, it, expect, vi } from 'vitest'
import { db } from '@/lib/db/client'
import { productTranslations } from '@/lib/db/schema'
import type { SessionUser } from '@open-hybrid-cloud/types'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder,
  createInfraElement,
} from '@/test/helpers'

vi.mock('@/lib/ci/webhooks', () => ({
  triggerProductWebhooks: vi.fn().mockResolvedValue([]),
  triggerPipelineStacks: vi.fn().mockResolvedValue([]),
  triggerProductWebhooksTracked: vi.fn().mockResolvedValue({ pipelineIds: [], failures: [] }),
  triggerPipelineStacksTracked: vi.fn().mockResolvedValue({ pipelineIds: [], failures: [] }),
}))

const { getDashboardSummary } = await import('./dashboard')

const session = (u: { id: number; role: string }): SessionUser =>
  ({ id: u.id, role: u.role, email: 'x@test.dev', name: 'X' }) as SessionUser

/**
 * Issue #158. The dashboard answered four questions — how many orders, how many
 * pending, how many elements active, how many projects — by downloading
 * `GET /api/orders`, `GET /api/infrastructure` and `GET /api/projects` in FULL
 * and calling `.length` and `.filter().length`. For an administrator that is
 * every order ever placed and every element ever provisioned, on the page every
 * user lands on immediately after login.
 *
 * The numbers therefore have to agree with those three list endpoints exactly,
 * including their scoping — a counter that disagrees with the page it links to
 * is worse than one that is slow.
 */
const world = async () => {
  const admin = await createUser({ role: 'admin', email: 'admin@test.dev' })
  const mine = await createUser({ role: 'project_manager', email: 'mine@test.dev' })
  const theirs = await createUser({ role: 'project_manager', email: 'theirs@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Virtual Machine')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const myProject = await createProject(mine.id, 'Mine')
  const theirProject = await createProject(theirs.id, 'Theirs')
  return { admin, mine, theirs, product, env, myProject, theirProject }
}

describe('getDashboardSummary', () => {
  it('counts an administrator\'s whole installation', async () => {
    const w = await world()
    await createOrder(w.myProject.id, w.product.id, w.env.id, w.mine.id, { status: 'pending' })
    const done = await createOrder(w.theirProject.id, w.product.id, w.env.id, w.theirs.id, {
      status: 'completed',
    })
    await createInfraElement(done.id, w.theirProject.id, w.env.id, w.product.id, {
      status: 'active',
    })

    const result = await getDashboardSummary(session(w.admin))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.orders.total).toBe(2)
    expect(result.data.orders.pending).toBe(1)
    expect(result.data.infrastructure.active).toBe(1)
    expect(result.data.projects.total).toBe(2)
  })

  // The scoping is the part that must not drift: `listOrders` filters by
  // `orders.user_id`, `listProjects` by `projects.owner_id`, and
  // `listInfrastructure` through the element's PROJECT, because an element has
  // no user of its own.
  it('counts only what a project manager can see', async () => {
    const w = await world()
    await createOrder(w.myProject.id, w.product.id, w.env.id, w.mine.id, { status: 'pending' })
    const theirOrder = await createOrder(w.theirProject.id, w.product.id, w.env.id, w.theirs.id, {
      status: 'completed',
    })
    await createInfraElement(theirOrder.id, w.theirProject.id, w.env.id, w.product.id, {
      status: 'active',
    })
    const myOrder = await createOrder(w.myProject.id, w.product.id, w.env.id, w.mine.id, {
      status: 'completed',
    })
    await createInfraElement(myOrder.id, w.myProject.id, w.env.id, w.product.id, { status: 'active' })

    const result = await getDashboardSummary(session(w.mine))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.orders.total).toBe(2)
    expect(result.data.orders.pending).toBe(1)
    // Their element is active too, and must not be counted here.
    expect(result.data.infrastructure.active).toBe(1)
    expect(result.data.projects.total).toBe(1)

    // The recent-orders LIST is scoped too, not just the counters. This is the
    // half a count assertion cannot reach: the numbers can be right while the
    // rows underneath them belong to somebody else, and those rows carry a
    // product name, a project name and a link to the order.
    expect(result.data.recentOrders.map((o) => o.id)).not.toContain(theirOrder.id)
    expect(result.data.recentOrders.map((o) => o.projectName)).toEqual(['Mine', 'Mine'])
  })

  it('counts only ACTIVE elements, not decommissioned ones', async () => {
    const w = await world()
    const order = await createOrder(w.myProject.id, w.product.id, w.env.id, w.mine.id, {
      status: 'completed',
    })
    await createInfraElement(order.id, w.myProject.id, w.env.id, w.product.id, { status: 'active' })
    await createInfraElement(order.id, w.myProject.id, w.env.id, w.product.id, {
      status: 'decommissioned',
    })
    await createInfraElement(order.id, w.myProject.id, w.env.id, w.product.id, {
      status: 'decommissioning',
    })

    const result = await getDashboardSummary(session(w.mine))

    expect(result.ok && result.data.infrastructure.active).toBe(1)
  })

  // The whole point of the endpoint: a fixed-size response. Six orders exist and
  // five come back, so the payload does not grow with the installation.
  it('returns at most five recent orders, newest first', async () => {
    const w = await world()
    for (let i = 0; i < 6; i++) {
      await createOrder(w.myProject.id, w.product.id, w.env.id, w.mine.id, { status: 'completed' })
    }

    const result = await getDashboardSummary(session(w.mine))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.orders.total).toBe(6)
    expect(result.data.recentOrders).toHaveLength(5)
    const ids = result.data.recentOrders.map((o) => o.id)
    expect([...ids].sort((a, b) => b - a)).toEqual(ids)
  })

  it('names the product in the reader\'s language', async () => {
    const w = await world()
    await db.insert(productTranslations).values({
      productId: w.product.id,
      languageCode: 'de',
      name: 'Virtuelle Maschine',
      description: '',
    })
    await createOrder(w.myProject.id, w.product.id, w.env.id, w.mine.id, { status: 'completed' })

    const result = await getDashboardSummary(session(w.mine), 'de')

    expect(result.ok && result.data.recentOrders[0].productName).toBe('Virtuelle Maschine')
  })

  it('carries the environment and project a row renders', async () => {
    const w = await world()
    await createOrder(w.myProject.id, w.product.id, w.env.id, w.mine.id, { status: 'completed' })

    const result = await getDashboardSummary(session(w.mine))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [row] = result.data.recentOrders
    expect(row.projectName).toBe('Mine')
    expect(row.environmentName).toBe(w.env.name)
    expect(row.status).toBe('completed')
  })

  it('answers zeroes for a user with nothing, rather than failing', async () => {
    const w = await world()

    const result = await getDashboardSummary(session(w.theirs))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.orders).toEqual({ total: 0, pending: 0 })
    expect(result.data.infrastructure.active).toBe(0)
    expect(result.data.recentOrders).toEqual([])
  })
})
