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
import { orders, parameters } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const makeReq = (url: string, auth?: string) =>
  new NextRequest(url, auth ? { headers: { authorization: auth } } : undefined)

describe('GET /api/approvals', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/approvals'))
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager role', async () => {
    const user = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/approvals', auth))
    expect(res.status).toBe(403)
  })

  it('returns pending orders for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const proj = await createProject(pm.id)

    await createOrder(proj.id, product.id, env.id, pm.id, { status: 'pending' })

    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/approvals', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.length).toBeGreaterThanOrEqual(1)
    expect(body.every((o: { status: string }) => o.status === 'pending')).toBe(true)
  })

  it('does not return non-pending orders', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const proj = await createProject(pm.id)

    await createOrder(proj.id, product.id, env.id, pm.id, { status: 'provisioning' })
    await createOrder(proj.id, product.id, env.id, pm.id, { status: 'rejected' })

    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/approvals', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.every((o: { status: string }) => o.status === 'pending')).toBe(true)
  })

  it('returns empty array when no pending orders', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/approvals', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  })

  it('root user can also view approvals', async () => {
    const user = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/approvals', auth))
    expect(res.status).toBe(200)
  })

  // Issue #131: the queue is every pending order shown to every admin, and the
  // approvals page renders none of these values — so the cleartext in the payload
  // shipped every orderer's secrets to every approver for no purpose at all.
  it('never serves a sensitive parameter value', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const proj = await createProject(pm.id)

    await db.insert(parameters).values({
      scope: 'product',
      scopeId: product.id,
      name: 'ADMIN_PASSWORD',
      type: 'string',
      sensitive: true,
    })

    const order = await createOrder(proj.id, product.id, env.id, pm.id, { status: 'pending' })
    await db
      .update(orders)
      .set({ parameters: { HOSTNAME: 'web-01', ADMIN_PASSWORD: 'sup3rs3cret' } })
      .where(eq(orders.id, order.id))

    const res = await GET(makeReq('http://localhost/api/approvals', await makeAuthHeader(admin)))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('sup3rs3cret')
    // The approver still sees which parameters were submitted, and the ones that
    // are not secret in full.
    expect(text).toContain('ADMIN_PASSWORD')
    expect(text).toContain('web-01')
  })
})
