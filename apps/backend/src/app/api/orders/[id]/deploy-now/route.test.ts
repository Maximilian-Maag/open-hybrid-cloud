import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { POST } from './route'
import { db } from '@/lib/db/client'
import { orders } from '@/lib/db/schema'
import {
  createUser, createCategory, createProduct, createCiSource,
  createEnvironment, createProject, createOrder, makeAuthHeader,
} from '@/test/helpers'
import type * as OrdersService from '@/lib/services/orders'

vi.mock('@/lib/services/orders', async (importOriginal) => ({
  ...(await importOriginal<typeof OrdersService>()),
  provisionOrderElements: vi.fn(),
}))
import { provisionOrderElements } from '@/lib/services/orders'

/**
 * Root deploying a scheduled order early (#330).
 *
 * Root, not admin. Approving decides that an order should happen; this decides
 * it should happen NOW, outside the hours the company said it watches its own
 * systems — which is the guarantee the feature exists to make.
 */
const makeReq = (auth?: string) =>
  new NextRequest('http://localhost/api/orders/1/deploy-now', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  })

const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) })

const scheduled = async () => {
  const user = await createUser({ email: `dn-${Math.random()}@test.dev` })
  const category = await createCategory()
  const product = await createProduct(category.id)
  const ci = await createCiSource()
  const environment = await createEnvironment(ci.id)
  const project = await createProject(user.id)
  const order = await createOrder(project.id, product.id, environment.id, user.id, { status: 'pending' })
  await db
    .update(orders)
    .set({ status: 'scheduled', scheduledFor: new Date('2026-09-03T06:00:00Z') })
    .where(eq(orders.id, order.id))
  return order
}

beforeEach(() => {
  vi.mocked(provisionOrderElements).mockReset()
  vi.mocked(provisionOrderElements).mockResolvedValue({ elementIds: [1], pipelineIds: ['p1'], failures: [] } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/orders/[id]/deploy-now', () => {
  it('refuses an anonymous caller', async () => {
    const order = await scheduled()
    expect((await POST(makeReq(), params(order.id))).status).toBe(401)
  })

  // The point of the route: an admin can approve, only root can skip the window.
  it.each(['admin', 'project_manager'] as const)('refuses %s', async (role) => {
    const order = await scheduled()
    const auth = await makeAuthHeader(await createUser({ role, email: `dn-${role}-${Math.random()}@test.dev` }))

    expect((await POST(makeReq(auth), params(order.id))).status).toBe(403)
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].status).toBe('scheduled')
  })

  it('lets root deploy it now', async () => {
    const order = await scheduled()
    const root = await createUser({ role: 'root', email: `dn-root-${Math.random()}@test.dev` })

    const res = await POST(makeReq(await makeAuthHeader(root)), params(order.id))

    expect(res.status).toBe(200)
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(row.status).toBe('provisioning')
    expect(row.windowOverrideBy).toBe(root.id)
  })

  it('is a 400 for an order that is not scheduled', async () => {
    const order = await scheduled()
    // `scheduled_for` has to go with it: `orders_scheduled_consistency` refuses
    // a pending order that still carries a release time, which is the point of
    // the constraint — this state cannot be constructed by accident either.
    await db
      .update(orders)
      .set({ status: 'pending', scheduledFor: null })
      .where(eq(orders.id, order.id))
    const root = await createUser({ role: 'root', email: `dn-root-${Math.random()}@test.dev` })

    const res = await POST(makeReq(await makeAuthHeader(root)), params(order.id))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('pending')
  })

  it('is a 404 for an order that does not exist', async () => {
    const root = await createUser({ role: 'root', email: `dn-root-${Math.random()}@test.dev` })
    expect((await POST(makeReq(await makeAuthHeader(root)), params(999_999))).status).toBe(404)
  })

  it('refuses an id that is not a number', async () => {
    const root = await createUser({ role: 'root', email: `dn-root-${Math.random()}@test.dev` })
    expect((await POST(makeReq(await makeAuthHeader(root)), params('not-an-id'))).status).toBe(400)
  })

  it('reports a provisioning failure as a 502 and puts the order back', async () => {
    const order = await scheduled()
    const root = await createUser({ role: 'root', email: `dn-root-${Math.random()}@test.dev` })
    vi.mocked(provisionOrderElements).mockRejectedValue(new Error('CI unreachable'))

    const res = await POST(makeReq(await makeAuthHeader(root)), params(order.id))

    expect(res.status).toBe(502)
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].status).toBe('scheduled')
  })
})
