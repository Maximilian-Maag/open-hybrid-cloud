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
  createInfraElement,
  makeAuthHeader,
} from '@/test/helpers'
import { db } from '@/lib/db/client'
import { parameters, orders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { ProductSnapshot } from '@/lib/services/snapshot'

const makeReq = (url: string, auth?: string) =>
  new NextRequest(url, auth ? { headers: { authorization: auth } } : undefined)

describe('GET /api/infrastructure', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/infrastructure'))
    expect(res.status).toBe(401)
  })

  it('admin sees all infrastructure elements', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm1 = await createUser({ role: 'project_manager' })
    const pm2 = await createUser({ role: 'project_manager' })

    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    const proj1 = await createProject(pm1.id)
    const proj2 = await createProject(pm2.id)

    const order1 = await createOrder(proj1.id, product.id, env.id, pm1.id)
    const order2 = await createOrder(proj2.id, product.id, env.id, pm2.id)

    await createInfraElement(order1.id, proj1.id, env.id, product.id)
    await createInfraElement(order2.id, proj2.id, env.id, product.id)

    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/infrastructure', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    // A page, not a bare array (#158).
    expect(body.items.length).toBe(2)
  })

  it('project_manager only sees own projects infrastructure', async () => {
    const pm1 = await createUser({ role: 'project_manager' })
    const pm2 = await createUser({ role: 'project_manager' })

    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    const proj1 = await createProject(pm1.id)
    const proj2 = await createProject(pm2.id)

    const order1 = await createOrder(proj1.id, product.id, env.id, pm1.id)
    const order2 = await createOrder(proj2.id, product.id, env.id, pm2.id)

    await createInfraElement(order1.id, proj1.id, env.id, product.id)
    await createInfraElement(order2.id, proj2.id, env.id, product.id)

    const auth = await makeAuthHeader(pm1)
    const res = await GET(makeReq('http://localhost/api/infrastructure', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    // pm1 only sees infra from their own project
    expect(body.items.length).toBe(1)
    expect(body.items[0].projectId).toBe(proj1.id)
  })

  it('filters by productId', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })

    const cat = await createCategory()
    const prod1 = await createProduct(cat.id, 'Product A')
    const prod2 = await createProduct(cat.id, 'Product B')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const proj = await createProject(pm.id)

    const ord1 = await createOrder(proj.id, prod1.id, env.id, pm.id)
    const ord2 = await createOrder(proj.id, prod2.id, env.id, pm.id)

    await createInfraElement(ord1.id, proj.id, env.id, prod1.id)
    await createInfraElement(ord2.id, proj.id, env.id, prod2.id)

    const auth = await makeAuthHeader(admin)
    const res = await GET(
      makeReq(`http://localhost/api/infrastructure?productId=${prod1.id}`, auth),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.length).toBe(1)
    expect(body.items[0].productId).toBe(prod1.id)
  })

  it('filters by projectId', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })

    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    const proj1 = await createProject(pm.id)
    const proj2 = await createProject(pm.id)

    const ord1 = await createOrder(proj1.id, product.id, env.id, pm.id)
    const ord2 = await createOrder(proj2.id, product.id, env.id, pm.id)

    await createInfraElement(ord1.id, proj1.id, env.id, product.id)
    await createInfraElement(ord2.id, proj2.id, env.id, product.id)

    const auth = await makeAuthHeader(admin)
    const res = await GET(
      makeReq(`http://localhost/api/infrastructure?projectId=${proj1.id}`, auth),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.length).toBe(1)
    expect(body.items[0].projectId).toBe(proj1.id)
  })

  it('returns an empty page, not an empty array, when nothing is deployed', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/infrastructure', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    // The window is still reported on an empty result: a client that reads
    // `limit` to lay out its pager should not have to special-case zero rows.
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
    expect(body.limit).toBeGreaterThan(0)
  })

  /*
   * The whole list used to cross the wire. An installation accumulates elements
   * forever — decommissioned ones stay for the history — so this is the list
   * that grows without anybody placing an order (#158).
   */
  it('takes a page window off the query string', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await createProject(pm.id)
    for (let i = 0; i < 3; i++) {
      const order = await createOrder(project.id, product.id, env.id, pm.id)
      await createInfraElement(order.id, project.id, env.id, product.id)
    }

    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/infrastructure?limit=2', auth))
    const body = await res.json()

    expect(body.items).toHaveLength(2)
    expect(body.total).toBe(3)
  })

  it('refuses a malformed window rather than quietly ignoring it', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)

    const res = await GET(makeReq('http://localhost/api/infrastructure?limit=fifty', auth))

    expect(res.status).toBe(400)
  })

  // Issue #131: the detail endpoint and the CSV export both redacted, this list did
  // not — and the export builds FROM this list, so the cleartext travelled through
  // the list endpoint on its way to being hidden in the CSV.
  it('never serves a sensitive parameter value', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const proj = await createProject(pm.id)
    const order = await createOrder(proj.id, product.id, env.id, pm.id)

    await db.insert(parameters).values({
      scope: 'product',
      scopeId: product.id,
      name: 'admin_password',
      type: 'string',
      sensitive: true,
    })
    await createInfraElement(order.id, proj.id, env.id, product.id, {
      parameters: { hostname: 'web-01', admin_password: 'sup3rs3cret' },
    })

    // …and one whose definition has since been deleted from the catalogue, so only
    // the order's own snapshot still remembers it was secret.
    const forgotten = await createOrder(proj.id, product.id, env.id, pm.id)
    await db
      .update(orders)
      .set({
        // Only `.parameters` is read for the sensitivity answer, so the rest of the
        // snapshot is left out rather than filled with fiction.
        productSnapshot: {
          version: 1,
          parameters: [{ name: 'api_key', label: '', type: 'string', description: '', defaultValue: '', required: false, sensitive: true }],
        } as unknown as ProductSnapshot,
      })
      .where(eq(orders.id, forgotten.id))
    await createInfraElement(forgotten.id, proj.id, env.id, product.id, {
      parameters: { api_key: 'ak-live-9f2b' },
    })

    for (const user of [admin, pm]) {
      const res = await GET(makeReq('http://localhost/api/infrastructure', await makeAuthHeader(user)))
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text, user.role).not.toContain('sup3rs3cret')
      expect(text, user.role).not.toContain('ak-live-9f2b')
      // The keys stay: the list still has to be able to say a value is there.
      expect(text).toContain('admin_password')
      expect(text).toContain('web-01')
    }
  })
})
