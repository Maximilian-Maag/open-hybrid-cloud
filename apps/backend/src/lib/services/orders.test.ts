import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionUser } from '@open-hybrid-cloud/types'

vi.mock('@/lib/notification', () => ({
  sendOrderCreated: vi.fn().mockResolvedValue(undefined),
  sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ci/webhooks', () => ({
  triggerProductWebhooks: vi.fn().mockResolvedValue(['pipe-1']),
  triggerPipelineStacks: vi.fn().mockResolvedValue([]),
}))

import { listOrders, getOrderById, createOrder } from './orders'
import { sendOrderCreated, sendApprovalRequest } from '@/lib/notification'
import { triggerProductWebhooks } from '@/lib/ci/webhooks'
import { db } from '@/lib/db/client'
import { orders, infrastructureElements } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder as seedOrder,
} from '@/test/helpers'

const makeSession = (u: { id: number; email: string; name: string; role: string }): SessionUser =>
  ({ id: u.id, email: u.email, name: u.name, role: u.role as SessionUser['role'] })

const mockedTriggerWebhooks = vi.mocked(triggerProductWebhooks)
const mockedSendOrderCreated = vi.mocked(sendOrderCreated)
const mockedSendApprovalRequest = vi.mocked(sendApprovalRequest)

beforeEach(() => {
  mockedTriggerWebhooks.mockReset().mockResolvedValue(['pipe-1'])
  mockedSendOrderCreated.mockReset().mockResolvedValue(undefined)
  mockedSendApprovalRequest.mockReset().mockResolvedValue(undefined)
})

const buildBase = async () => {
  const admin = await createUser({ role: 'admin', email: 'admin@test.dev', name: 'Admin' })
  const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev', name: 'PM' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Product A')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const project = await createProject(pm.id)
  return { admin, pm, cat, product, ci, env, project }
}

describe('listOrders', () => {
  it('admin sees orders from all users', async () => {
    const { admin, pm, product, env, project } = await buildBase()
    const otherPm = await createUser({ role: 'project_manager', email: 'other@test.dev' })
    const otherProject = await createProject(otherPm.id)

    await seedOrder(project.id, product.id, env.id, pm.id)
    await seedOrder(otherProject.id, product.id, env.id, otherPm.id)

    const result = await listOrders(makeSession(admin))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(2)
    }
  })

  it('project manager sees only their own orders', async () => {
    const { pm, product, env, project } = await buildBase()
    const otherPm = await createUser({ role: 'project_manager', email: 'other@test.dev' })
    const otherProject = await createProject(otherPm.id)

    await seedOrder(project.id, product.id, env.id, pm.id)
    await seedOrder(otherProject.id, product.id, env.id, otherPm.id)

    const result = await listOrders(makeSession(pm))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].userId).toBe(pm.id)
    }
  })

  it('returns joined productName, environmentName, userName fields', async () => {
    const { pm, product, env, project } = await buildBase()
    await seedOrder(project.id, product.id, env.id, pm.id)

    const result = await listOrders(makeSession(pm))
    expect(result.ok).toBe(true)
    if (result.ok) {
      const row = result.data[0]
      expect(row.productName).toBe('Product A')
      expect(row.environmentName).toBe('Test Env')
      expect(row.userName).toBe('PM')
    }
  })
})

describe('getOrderById', () => {
  it('returns the order when found and admin calls', async () => {
    const { admin, pm, product, env, project } = await buildBase()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)

    const result = await getOrderById(makeSession(admin), order.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.id).toBe(order.id)
  })

  it('returns the order when PM is the owner', async () => {
    const { pm, product, env, project } = await buildBase()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)

    const result = await getOrderById(makeSession(pm), order.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.id).toBe(order.id)
  })

  it('returns 403 when PM tries to access another user\'s order', async () => {
    const { pm, product, env, project } = await buildBase()
    const otherPm = await createUser({ role: 'project_manager', email: 'other@test.dev' })
    const order = await seedOrder(project.id, product.id, env.id, pm.id)

    const result = await getOrderById(makeSession(otherPm), order.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('returns 404 for a non-existent order', async () => {
    const { admin } = await buildBase()
    const result = await getOrderById(makeSession(admin), 999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })
})

describe('createOrder (admin path)', () => {
  it('creates order with status provisioning, triggers webhooks with ORDER_ID, creates infra, notifies, returns infraId', async () => {
    const { admin, product, env, project } = await buildBase()
    mockedTriggerWebhooks.mockResolvedValueOnce(['pipe-admin-1'])

    const input = {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      parameters: { FOO: 'bar' },
    }

    const result = await createOrder(makeSession(admin), input)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.status).toBe('provisioning')
    expect(result.data.infraId).toBeDefined()

    // Verify in DB
    const [dbOrder] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(dbOrder.status).toBe('provisioning')
    expect(dbOrder.pipelineId).toEqual(['pipe-admin-1'])

    const infraRows = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.orderId, result.data.id))
    expect(infraRows.length).toBe(1)
    expect(infraRows[0].id).toBe(result.data.infraId)

    expect(mockedTriggerWebhooks).toHaveBeenCalledTimes(1)
    const [pid, eid, vars] = mockedTriggerWebhooks.mock.calls[0]
    expect(pid).toBe(product.id)
    expect(eid).toBe(env.id)
    expect(vars).toMatchObject({ FOO: 'bar', ORDER_ID: String(result.data.id) })

    expect(mockedSendOrderCreated).toHaveBeenCalledTimes(1)
    expect(mockedSendOrderCreated.mock.calls[0][0]).toBe('admin@test.dev')

    // No approval request for admin path
    expect(mockedSendApprovalRequest).not.toHaveBeenCalled()
  })
})

describe('createOrder (PM path)', () => {
  it('creates order with status pending, notifies orderer, notifies each active admin, does NOT trigger webhooks', async () => {
    const { admin, pm, product, env, project } = await buildBase()
    // Add another admin and an inactive admin
    const admin2 = await createUser({ role: 'admin', email: 'admin2@test.dev' })
    await createUser({ role: 'admin', email: 'inactive@test.dev', active: false })

    const input = {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      parameters: { FOO: 'bar' },
    }

    const result = await createOrder(makeSession(pm), input)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.status).toBe('pending')
    // No infraId on PM path
    expect((result.data as { infraId?: number }).infraId).toBeUndefined()

    // No webhook triggered
    expect(mockedTriggerWebhooks).not.toHaveBeenCalled()

    // Orderer notified
    expect(mockedSendOrderCreated).toHaveBeenCalledTimes(1)
    expect(mockedSendOrderCreated.mock.calls[0][0]).toBe('pm@test.dev')

    // Two active admins notified (admin + admin2); inactive excluded
    expect(mockedSendApprovalRequest).toHaveBeenCalledTimes(2)
    const notifiedAdmins = mockedSendApprovalRequest.mock.calls.map((c) => c[0]).sort()
    expect(notifiedAdmins).toEqual([admin.email, admin2.email].sort())

    // Order persisted with correct fields
    const [dbOrder] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(dbOrder.status).toBe('pending')
    expect(dbOrder.userId).toBe(pm.id)
    expect(dbOrder.parameters).toEqual({ FOO: 'bar' })

    // No infra created for PM path
    const infra = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.orderId, result.data.id))
    expect(infra.length).toBe(0)
  })
})
