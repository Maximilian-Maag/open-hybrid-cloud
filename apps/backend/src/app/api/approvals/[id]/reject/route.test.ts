import { vi, describe, it, expect } from 'vitest'

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
import { sendOrderRejected } from '@/lib/notification'
import { db } from '@/lib/db/client'
import { orders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const makeReq = (url: string, body?: unknown, auth?: string) =>
  new NextRequest(url, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('POST /api/approvals/[id]/reject', () => {
  it('returns 401 without auth token', async () => {
    const res = await POST(
      makeReq('http://localhost/api/approvals/1/reject', { rejectionNote: 'No budget' }),
      { params: Promise.resolve({ id: '1' }) },
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager role', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await POST(
      makeReq('http://localhost/api/approvals/1/reject', { rejectionNote: 'No' }, auth),
      { params: Promise.resolve({ id: '1' }) },
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 when rejectionNote is missing', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq('http://localhost/api/approvals/1/reject', {}, auth),
      { params: Promise.resolve({ id: '1' }) },
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when rejectionNote is empty string', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq('http://localhost/api/approvals/1/reject', { rejectionNote: '' }, auth),
      { params: Promise.resolve({ id: '1' }) },
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 for non-existent order', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq('http://localhost/api/approvals/999999/reject', { rejectionNote: 'nope' }, auth),
      { params: Promise.resolve({ id: '999999' }) },
    )
    expect(res.status).toBe(404)
  })

  it('rejects pending order: stores note, transitions to rejected, calls sendOrderRejected', async () => {
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
      makeReq(
        `http://localhost/api/approvals/${order.id}/reject`,
        { rejectionNote: 'Budget exceeded' },
        auth,
      ),
      { params: Promise.resolve({ id: String(order.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    // Order status updated to rejected with note
    const updated = await db
      .select({ status: orders.status, rejectionNote: orders.rejectionNote })
      .from(orders)
      .where(eq(orders.id, order.id))
    expect(updated[0]?.status).toBe('rejected')
    expect(updated[0]?.rejectionNote).toBe('Budget exceeded')

    // Notification sent to orderer
    expect(sendOrderRejected).toHaveBeenCalledWith(
      pm.email,
      expect.any(String),
      order.id,
      'Budget exceeded',
    )
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
      makeReq(
        `http://localhost/api/approvals/${order.id}/reject`,
        { rejectionNote: 'Late' },
        auth,
      ),
      { params: Promise.resolve({ id: String(order.id) }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Order is not pending')
  })
})
