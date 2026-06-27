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
  makeAuthHeader,
} from '@/test/helpers'
import { sendApprovalRequest, sendOrderCreated } from '@/lib/notification'
import { db } from '@/lib/db/client'
import { infrastructureElements } from '@/lib/db/schema'

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
    const body = await res.json()
    expect(body.length).toBeGreaterThanOrEqual(1)
  })

  it('project_manager only sees own orders', async () => {
    const pm1 = await createUser({ role: 'project_manager' })
    const pm2 = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
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
    expect(body.length).toBe(1)
    expect(body[0].userId).toBe(pm1.id)
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
    )
  })

  it('admin creates provisioning order with infra element', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
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
