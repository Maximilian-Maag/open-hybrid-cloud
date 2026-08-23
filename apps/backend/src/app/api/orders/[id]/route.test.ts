import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder,
  makeAuthHeader,
} from '@/test/helpers'
import { db } from '@/lib/db/client'
import { parameters, orders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { ProductSnapshot } from '@/lib/services/snapshot'

const makeReq = (id: string, auth?: string) =>
  new NextRequest(`http://localhost/api/orders/${id}`, {
    headers: auth ? { authorization: auth } : {},
  })

describe('GET /api/orders/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await GET(makeReq('1'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 for non-existent order', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq('999999', auth), { params: Promise.resolve({ id: '999999' }) })
    expect(res.status).toBe(404)
  })

  it('returns 403 when project_manager accesses another user\'s order', async () => {
    const pm1 = await createUser({ role: 'project_manager', email: 'pm1@test.dev' })
    const pm2 = await createUser({ role: 'project_manager', email: 'pm2@test.dev' })
    const cat = await createCategory()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const p = await createProduct(cat.id)
    const proj = await createProject(pm2.id)
    const order = await createOrder(proj.id, p.id, env.id, pm2.id)

    const auth = await makeAuthHeader(pm1)
    const res = await GET(makeReq(String(order.id), auth), { params: Promise.resolve({ id: String(order.id) }) })
    expect(res.status).toBe(403)
  })

  it('returns order for the owning project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const p = await createProduct(cat.id)
    const proj = await createProject(pm.id)
    const order = await createOrder(proj.id, p.id, env.id, pm.id)

    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq(String(order.id), auth), { params: Promise.resolve({ id: String(order.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(order.id)
  })

  it('admin can access any order', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const cat = await createCategory()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const p = await createProduct(cat.id)
    const proj = await createProject(pm.id)
    const order = await createOrder(proj.id, p.id, env.id, pm.id)

    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq(String(order.id), auth), { params: Promise.resolve({ id: String(order.id) }) })
    expect(res.status).toBe(200)
  })

  // Issue #131. The order detail PAGE masked with `def?.sensitive ? '••••••'`, where
  // `def` comes from the order's snapshot alone — so an order placed before
  // snapshots existed had no `def`, and the page rendered the secret in plaintext.
  // Either way the value was in this JSON, which is what this asserts about.
  it('never serves a sensitive parameter value, snapshot or no snapshot', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: `own-${Math.random()}@test.dev` })
    const cat = await createCategory()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const p = await createProduct(cat.id)
    const proj = await createProject(pm.id)

    await db.insert(parameters).values({
      scope: 'product',
      scopeId: p.id,
      name: 'ADMIN_PASSWORD',
      type: 'string',
      sensitive: true,
    })

    // The pre-snapshot order: productSnapshot stays null, so only the live
    // catalogue knows this parameter is sensitive.
    const legacy = await createOrder(proj.id, p.id, env.id, pm.id)
    await db
      .update(orders)
      .set({ parameters: { HOSTNAME: 'web-01', ADMIN_PASSWORD: 'sup3rs3cret' } })
      .where(eq(orders.id, legacy.id))

    // And the mirror case: the definition is gone from the catalogue, only the
    // snapshot remembers.
    const snapshotted = await createOrder(proj.id, p.id, env.id, pm.id)
    await db
      .update(orders)
      .set({
        parameters: { API_KEY: 'ak-live-9f2b' },
        // Only `.parameters` is read for the sensitivity answer, so the rest of the
        // snapshot is left out rather than filled with fiction.
        productSnapshot: {
          version: 1,
          parameters: [{ name: 'API_KEY', label: '', type: 'string', description: '', defaultValue: '', required: false, sensitive: true }],
        } as unknown as ProductSnapshot,
      })
      .where(eq(orders.id, snapshotted.id))

    for (const user of [pm, admin]) {
      const auth = await makeAuthHeader(user)
      for (const [order, secret] of [[legacy, 'sup3rs3cret'], [snapshotted, 'ak-live-9f2b']] as const) {
        const res = await GET(makeReq(String(order.id), auth), {
          params: Promise.resolve({ id: String(order.id) }),
        })
        expect(res.status).toBe(200)
        const text = await res.text()
        expect(text, `${user.role} / order ${order.id}`).not.toContain(secret)
        expect(JSON.parse(text).parameters).toHaveProperty(
          order.id === legacy.id ? 'ADMIN_PASSWORD' : 'API_KEY',
          '[redacted]',
        )
      }
    }
  })
})
