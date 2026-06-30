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
import { POST } from './route'
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
import { sendOrderApproved } from '@/lib/notification'
import { db } from '@/lib/db/client'
import { infrastructureElements, orders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const makeReq = (url: string, auth?: string) =>
  new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('POST /api/approvals/[id]/approve', () => {
  it('returns 401 without auth token', async () => {
    const res = await POST(makeReq('http://localhost/api/approvals/1/approve'), {
      params: Promise.resolve({ id: '1' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager role', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await POST(makeReq('http://localhost/api/approvals/1/approve', auth), {
      params: Promise.resolve({ id: '1' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 404 for non-existent order', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(makeReq('http://localhost/api/approvals/999999/approve', auth), {
      params: Promise.resolve({ id: '999999' }),
    })
    expect(res.status).toBe(404)
  })

  it('approves pending order: transitions to provisioning, creates infra element, calls sendOrderApproved', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const proj = await createProject(pm.id)

    const order = await createOrder(proj.id, product.id, env.id, pm.id, { status: 'pending' })

    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq(`http://localhost/api/approvals/${order.id}/approve`, auth),
      { params: Promise.resolve({ id: String(order.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.infraId).toBeDefined()

    // Order status updated to provisioning
    const updatedOrders = await db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, order.id))
    expect(updatedOrders[0]?.status).toBe('provisioning')

    // Infra element created
    const infra = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, body.infraId))
    expect(infra.length).toBe(1)
    expect(infra[0].orderId).toBe(order.id)

    // sendOrderApproved called with orderer's email
    expect(sendOrderApproved).toHaveBeenCalledWith(pm.email, expect.any(String), order.id)
  })

  it('returns 400 if order is not pending', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const proj = await createProject(pm.id)

    const order = await createOrder(proj.id, product.id, env.id, pm.id, { status: 'provisioning' })

    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq(`http://localhost/api/approvals/${order.id}/approve`, auth),
      { params: Promise.resolve({ id: String(order.id) }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Order is not pending')
  })
})
