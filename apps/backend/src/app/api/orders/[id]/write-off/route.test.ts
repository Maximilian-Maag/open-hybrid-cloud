import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import {
  createUser, createCategory, createProduct, createCiSource, createEnvironment,
  linkProductEnvironment, createProject, createOrder, makeAuthHeader,
} from '@/test/helpers'
import { db } from '@/lib/db/client'
import { orders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { STUCK_ORDER_SILENCE_MS } from '@/lib/services/orders'

/**
 * The HTTP surface of writing off a stuck order (#181, #206).
 *
 * `requireRole('root')`, stricter than the 'admin' its neighbours take: this
 * writes a status nobody observed — a failure inferred from silence rather than
 * one CI reported — and that is the installation owner's call, not anyone who
 * can approve an order. The service checks the role a second time, and the audit
 * entry it writes has to be true.
 */

const makeReq = (id: string, body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/orders/${id}/write-off`, {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  })

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

/** An order stuck in provisioning, silent for longer than the threshold. */
async function stuckOrder() {
  const root = await createUser({ role: 'root' })
  const pm = await createUser({ role: 'project_manager' })
  const cat = await createCategory()
  const product = await createProduct(cat.id)
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  await linkProductEnvironment(product.id, env.id)
  const project = await createProject(pm.id)
  const order = await createOrder(project.id, product.id, env.id, pm.id, { status: 'provisioning' })

  const longAgo = new Date(Date.now() - STUCK_ORDER_SILENCE_MS - 60_000)
  await db.update(orders).set({ updatedAt: longAgo }).where(eq(orders.id, order.id))

  return { root, order, auth: await makeAuthHeader(root) }
}

describe('POST /api/orders/[id]/write-off', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await POST(makeReq('1', { reason: 'x' }), ctx('1'))).status).toBe(401)
  })

  it('refuses an admin, which the neighbouring order routes allow', async () => {
    const admin = await createUser({ role: 'admin' })
    const res = await POST(makeReq('1', { reason: 'x' }, await makeAuthHeader(admin)), ctx('1'))
    expect(res.status).toBe(403)
  })

  it('marks the order failed for root', async () => {
    const { order, auth } = await stuckOrder()

    const res = await POST(makeReq(String(order.id), { reason: 'pipeline never reported' }, auth), ctx(String(order.id)))

    expect(res.status).toBe(200)
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(row.status).toBe('failed')
  })

  it('answers 404 for an order that is not there', async () => {
    const { auth } = await stuckOrder()
    expect((await POST(makeReq('999999', { reason: 'x' }, auth), ctx('999999'))).status).toBe(404)
  })

  // The reason is not optional and not decorative: it goes in the audit entry,
  // which is the only record that this failure was inferred rather than observed.
  it.each([
    ['no body at all', undefined],
    ['no reason', {}],
    ['an empty reason', { reason: '' }],
  ])('rejects %s with 400', async (_name, body) => {
    const { order, auth } = await stuckOrder()
    expect((await POST(makeReq(String(order.id), body, auth), ctx(String(order.id)))).status).toBe(400)
  })

  it.each(['0x10', ' 5 ', 'abc', '-1'])('refuses the malformed id %s with 400', async (id) => {
    const { auth } = await stuckOrder()
    expect((await POST(makeReq(id, { reason: 'x' }, auth), ctx(id))).status).toBe(400)
  })
})
