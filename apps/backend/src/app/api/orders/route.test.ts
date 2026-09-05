import { vi, describe, it, expect } from 'vitest'

vi.mock('@/lib/ci', () => ({ triggerPipeline: vi.fn().mockResolvedValue('pipeline-1') }))
vi.mock('@/lib/notification', () => ({
  sendOrderCreated: vi.fn(),
  sendApprovalRequest: vi.fn(),
  sendOrderApproved: vi.fn(),
  sendOrderRejected: vi.fn(),
  sendProvisioningCompleted: vi.fn(),
  sendProvisioningFailed: vi.fn(),
  sendDecommissioned: vi.fn(),
}))

import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  linkProductEnvironment,
  createProductWebhook,
  makeAuthHeader,
} from '@/test/helpers'
import { sendApprovalRequest, sendOrderCreated } from '@/lib/notification'
import { db } from '@/lib/db/client'
import { infrastructureElements, orders, parameters } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const makeReq = (url: string, body?: unknown, auth?: string) =>
  new NextRequest(url, {
    method: body !== undefined ? 'POST' : 'GET',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('GET /api/orders', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/orders'))
    expect(res.status).toBe(401)
  })

  it('admin sees all orders', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await linkProductEnvironment(product.id, env.id)
    const proj = await createProject(pm.id)

    // Create order as PM
    const pmAuth = await makeAuthHeader(pm)
    await POST(
      makeReq(
        'http://localhost/api/orders',
        { projectId: proj.id, productId: product.id, environmentId: env.id, parameters: {} },
        pmAuth,
      ),
    )

    const adminAuth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/orders', undefined, adminAuth))
    expect(res.status).toBe(200)
    // A page, not a bare array (#158). The endpoint used to serialise every
    // order the caller could see, each carrying two jsonb columns.
    const body = await res.json()
    expect(body.items.length).toBeGreaterThanOrEqual(1)
    expect(body.total).toBeGreaterThanOrEqual(1)
  })

  it('project_manager only sees own orders', async () => {
    const pm1 = await createUser({ role: 'project_manager' })
    const pm2 = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await linkProductEnvironment(product.id, env.id)
    const proj1 = await createProject(pm1.id)
    const proj2 = await createProject(pm2.id)

    const auth1 = await makeAuthHeader(pm1)
    const auth2 = await makeAuthHeader(pm2)

    await POST(
      makeReq(
        'http://localhost/api/orders',
        { projectId: proj1.id, productId: product.id, environmentId: env.id, parameters: {} },
        auth1,
      ),
    )
    await POST(
      makeReq(
        'http://localhost/api/orders',
        { projectId: proj2.id, productId: product.id, environmentId: env.id, parameters: {} },
        auth2,
      ),
    )

    const res = await GET(makeReq('http://localhost/api/orders', undefined, auth1))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.length).toBe(1)
    expect(body.items[0].userId).toBe(pm1.id)
    // The count is scoped too, or it would tell a project manager how many
    // orders exist in projects they cannot see.
    expect(body.total).toBe(1)
  })

  /*
   * The route reads the query string now. `/projects/7` has always fetched
   * `/api/orders?projectId=7` and nothing has ever read it, so that page's
   * "Orders in this project" card listed every order the viewer could see
   * (#158).
   */
  it('honours the projectId the project page has always been sending', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await linkProductEnvironment(product.id, env.id)
    const mine = await createProject(pm.id)
    const other = await createProject(pm.id)

    const auth = await makeAuthHeader(pm)
    for (const projectId of [mine.id, other.id]) {
      await POST(
        makeReq(
          'http://localhost/api/orders',
          { projectId, productId: product.id, environmentId: env.id, parameters: {} },
          auth,
        ),
      )
    }

    const res = await GET(makeReq(`http://localhost/api/orders?projectId=${mine.id}`, undefined, auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].projectId).toBe(mine.id)
  })

  it('refuses a malformed filter rather than quietly ignoring it', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)

    const res = await GET(makeReq('http://localhost/api/orders?projectId=abc', undefined, auth))

    // 400, not "here is everything": a dropped filter is indistinguishable from
    // one that matched the whole table.
    expect(res.status).toBe(400)
  })

  it('takes a page window off the query string', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await linkProductEnvironment(product.id, env.id)
    const proj = await createProject(pm.id)

    const auth = await makeAuthHeader(pm)
    for (let i = 0; i < 3; i++) {
      await POST(
        makeReq(
          'http://localhost/api/orders',
          { projectId: proj.id, productId: product.id, environmentId: env.id, parameters: {} },
          auth,
        ),
      )
    }

    const res = await GET(makeReq('http://localhost/api/orders?limit=2', undefined, auth))
    const body = await res.json()
    expect(body.items).toHaveLength(2)
    expect(body.total).toBe(3)
    expect(body.limit).toBe(2)
  })
})

describe('POST /api/orders', () => {
  it('returns 401 without auth token', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify({ projectId: 1, productId: 1, environmentId: 1, parameters: {} }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid body', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await POST(makeReq('http://localhost/api/orders', { projectId: 'not-a-number' }, auth))
    expect(res.status).toBe(400)
  })

  it('project_manager creates pending order and calls sendApprovalRequest for admins', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const admin = await createUser({ role: 'admin' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await linkProductEnvironment(product.id, env.id)
    const proj = await createProject(pm.id)

    const auth = await makeAuthHeader(pm)
    const res = await POST(
      makeReq(
        'http://localhost/api/orders',
        { projectId: proj.id, productId: product.id, environmentId: env.id, parameters: {} },
        auth,
      ),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.status).toBe('pending')
    expect(body.userId).toBe(pm.id)

    // sendOrderCreated called for orderer
    expect(sendOrderCreated).toHaveBeenCalledWith(pm.email, expect.any(String), body.id)
    // sendApprovalRequest called for admin
    expect(sendApprovalRequest).toHaveBeenCalledWith(
      admin.email,
      expect.any(String),
      body.id,
      pm.name,
      // The fifth argument is who this admin is substituting for. Empty here:
      // no delegation is in play, and asserting it explicitly is what keeps a
      // future delegation leaking into an ordinary approval mail visible.
      [],
    )
  })

  it('admin creates provisioning order with infra element', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await linkProductEnvironment(product.id, env.id)
    // Something to deploy it with. Without this the order is refused since #206:
    // a product with no webhook and no pipeline stack has nothing to trigger, and
    // this fixture used to assert the dead-end state that produced.
    await createProductWebhook(product.id, env.id)
    const proj = await createProject(pm.id)

    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq(
        'http://localhost/api/orders',
        { projectId: proj.id, productId: product.id, environmentId: env.id, parameters: {} },
        auth,
      ),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.status).toBe('provisioning')
    expect(body.infraId).toBeDefined()

    // Verify infra element exists in DB
    const infra = await db
      .select()
      .from(infrastructureElements)
      .where(undefined)
    expect(infra.some((el) => el.id === body.infraId)).toBe(true)

    // sendOrderCreated called for admin orderer
    expect(sendOrderCreated).toHaveBeenCalledWith(admin.email, expect.any(String), body.id)
  })

  it('missing parameters field returns 400', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await POST(
      makeReq('http://localhost/api/orders', { projectId: 1, productId: 1, environmentId: 1 }, auth),
    )
    expect(res.status).toBe(400)
  })
})

// Issue #131: an admin lists every order, so the cleartext values in this payload
// were every orderer's secrets. Checked end-to-end through POST so the assertion
// covers the value as actually stored by the ordering flow, not a hand-written row.
describe('GET /api/orders — sensitive values', () => {
  it('the checked-out secret does not come back out', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await linkProductEnvironment(product.id, env.id)
    const proj = await createProject(pm.id)

    await db.insert(parameters).values({
      scope: 'product',
      scopeId: product.id,
      name: 'ADMIN_PASSWORD',
      type: 'string',
      sensitive: true,
    })

    const pmAuth = await makeAuthHeader(pm)
    const created = await POST(
      makeReq(
        'http://localhost/api/orders',
        {
          projectId: proj.id,
          productId: product.id,
          environmentId: env.id,
          parameters: { ADMIN_PASSWORD: 'sup3rs3cret' },
        },
        pmAuth,
      ),
    )
    expect(created.status).toBe(201)

    // Checkout must still get the value IN — the pipeline needs it, and the stored
    // row is what the trigger reads.
    const [stored] = await db.select().from(orders).where(eq(orders.id, (await created.json()).id))
    expect(stored.parameters).toEqual({ ADMIN_PASSWORD: 'sup3rs3cret' })

    for (const auth of [pmAuth, await makeAuthHeader(admin)]) {
      const res = await GET(makeReq('http://localhost/api/orders', undefined, auth))
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text).not.toContain('sup3rs3cret')
      expect(text).toContain('ADMIN_PASSWORD')
    }
  })
})
