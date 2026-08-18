import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionUser } from '@open-hybrid-cloud/types'

vi.mock('@/lib/notification', () => ({
  sendOrderApproved: vi.fn().mockResolvedValue(undefined),
  sendOrderRejected: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ci/webhooks', () => ({
  triggerProductWebhooks: vi.fn().mockResolvedValue(['pipe-42']),
  triggerPipelineStacks: vi.fn().mockResolvedValue([]),
}))

import { listApprovals, approveOrder, rejectOrder } from './approvals'
import { sendOrderApproved, sendOrderRejected } from '@/lib/notification'
import { triggerProductWebhooks } from '@/lib/ci/webhooks'
import { db } from '@/lib/db/client'
import { orders, infrastructureElements, productEnvironments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder as seedOrder,
  linkProductEnvironment,
} from '@/test/helpers'

const makeSession = (u: { id: number; email: string; name: string; role: string }): SessionUser =>
  ({ id: u.id, email: u.email, name: u.name, role: u.role as SessionUser['role'] })

const mockedWebhooks = vi.mocked(triggerProductWebhooks)
const mockedApproved = vi.mocked(sendOrderApproved)
const mockedRejected = vi.mocked(sendOrderRejected)

beforeEach(() => {
  mockedWebhooks.mockReset().mockResolvedValue(['pipe-42'])
  mockedApproved.mockReset().mockResolvedValue(undefined)
  mockedRejected.mockReset().mockResolvedValue(undefined)
})

const setup = async () => {
  const admin = await createUser({ role: 'admin', email: 'admin@test.dev', name: 'Admin' })
  const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev', name: 'PM' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Product A')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const project = await createProject(pm.id)
  return { admin, pm, product, env, project }
}

describe('listApprovals', () => {
  it('returns only pending orders with joined fields', async () => {
    const { pm, product, env, project } = await setup()
    const pending = await seedOrder(project.id, product.id, env.id, pm.id, { status: 'pending' })
    await seedOrder(project.id, product.id, env.id, pm.id, { status: 'completed' })
    await seedOrder(project.id, product.id, env.id, pm.id, { status: 'rejected' })

    const result = await listApprovals()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.length).toBe(1)
    expect(result.data[0].id).toBe(pending.id)
    expect(result.data[0].productName).toBe('Product A')
    expect(result.data[0].environmentName).toBe('Test Env')
    expect(result.data[0].userName).toBe('PM')
    expect(result.data[0].projectName).toBe('Test Project')
  })

  it('returns empty list when no pending orders exist', async () => {
    const { pm, product, env, project } = await setup()
    await seedOrder(project.id, product.id, env.id, pm.id, { status: 'completed' })

    const result = await listApprovals()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })
})

describe('approveOrder', () => {
  it('returns 404 for unknown order', async () => {
    const { admin } = await setup()
    const result = await approveOrder(makeSession(admin), 999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns 400 when order is not pending', async () => {
    const { admin, pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id, { status: 'completed' })

    const result = await approveOrder(makeSession(admin), order.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('updates order status to provisioning, creates infra, triggers webhooks, notifies, returns success', async () => {
    const { admin, pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id, { status: 'pending' })
    mockedWebhooks.mockResolvedValueOnce(['pipe-approved'])

    const result = await approveOrder(makeSession(admin), order.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.success).toBe(true)
    expect(result.data.pipelineIds).toEqual(['pipe-approved'])
    expect(result.data.infraId).toBeDefined()

    // Order updated in DB
    const [dbOrder] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(dbOrder.status).toBe('provisioning')
    expect(dbOrder.pipelineId).toEqual(['pipe-approved'])

    // Infra created in DB
    const infra = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.orderId, order.id))
    expect(infra.length).toBe(1)

    // Webhook triggered with ORDER_ID
    expect(mockedWebhooks).toHaveBeenCalledTimes(1)
    const [pid, eid, vars] = mockedWebhooks.mock.calls[0]
    expect(pid).toBe(product.id)
    expect(eid).toBe(env.id)
    expect(vars).toMatchObject({ ORDER_ID: String(order.id) })

    // Notification sent to the order's owner
    expect(mockedApproved).toHaveBeenCalledTimes(1)
    expect(mockedApproved.mock.calls[0][0]).toBe('pm@test.dev')
  })
})

describe('rejectOrder', () => {
  it('returns 404 for unknown order', async () => {
    const { admin } = await setup()
    const result = await rejectOrder(makeSession(admin), 999_999, 'no')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns 400 when order is not pending', async () => {
    const { admin, pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id, { status: 'completed' })

    const result = await rejectOrder(makeSession(admin), order.id, 'because')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('updates status to rejected with rejectionNote, notifies, returns ok(undefined)', async () => {
    const { admin, pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id, { status: 'pending' })

    const result = await rejectOrder(makeSession(admin), order.id, 'Budget exceeded')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toBeUndefined()

    const [dbOrder] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(dbOrder.status).toBe('rejected')
    expect(dbOrder.rejectionNote).toBe('Budget exceeded')

    expect(mockedRejected).toHaveBeenCalledTimes(1)
    expect(mockedRejected.mock.calls[0][0]).toBe('pm@test.dev')
    expect(mockedRejected.mock.calls[0][3]).toBe('Budget exceeded')
  })
})

// Issue #1. A project manager's trial waits for approval like any other order, so
// approval is where the trial is actually provisioned — and where its clock has to
// start. Starting it at order time could burn the whole trial, or expire it
// outright, before the infrastructure existed.
describe('approveOrder — time-boxed trials', () => {
  const buildTrial = async (over?: { trialEnabled?: boolean; trialDurationMinutes?: number }) => {
    const ctx = await setup()
    await linkProductEnvironment(ctx.product.id, ctx.env.id, { trialEnabled: true, ...over })
    return ctx
  }

  const infraFor = async (orderId: number) =>
    (await db.select().from(infrastructureElements).where(eq(infrastructureElements.orderId, orderId)))[0]

  it('starts the clock at approval, not at order time', async () => {
    const ctx = await buildTrial({ trialDurationMinutes: 30 })
    const order = await seedOrder(ctx.project.id, ctx.product.id, ctx.env.id, ctx.pm.id, {
      status: 'pending',
      isTrial: true,
    })

    const approvedAt = Date.now()
    const result = await approveOrder(makeSession(ctx.admin), order.id)
    expect(result.ok).toBe(true)

    const infra = await infraFor(order.id)
    const expiry = infra.scheduledDecommissionAt?.getTime() ?? 0
    expect(expiry).toBeGreaterThanOrEqual(approvedAt + 30 * 60_000)
    expect(expiry).toBeLessThanOrEqual(Date.now() + 30 * 60_000)
  })

  it('passes the trial variables to CI on approval', async () => {
    const ctx = await buildTrial({ trialDurationMinutes: 45 })
    const order = await seedOrder(ctx.project.id, ctx.product.id, ctx.env.id, ctx.pm.id, {
      status: 'pending',
      isTrial: true,
    })

    await approveOrder(makeSession(ctx.admin), order.id)
    expect(mockedWebhooks).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ TRIAL: 'true', TRIAL_DURATION_MINUTES: '45' }),
    )
  })

  it('applies a duration an admin corrected while the order was pending', async () => {
    // Re-read from the offering rather than snapshotted on the order, so the
    // current configuration is the one that applies.
    const ctx = await buildTrial({ trialDurationMinutes: 30 })
    const order = await seedOrder(ctx.project.id, ctx.product.id, ctx.env.id, ctx.pm.id, {
      status: 'pending',
      isTrial: true,
    })
    await db
      .update(productEnvironments)
      .set({ trialDurationMinutes: 90 })
      .where(eq(productEnvironments.productId, ctx.product.id))

    await approveOrder(makeSession(ctx.admin), order.id)
    expect(mockedWebhooks).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ TRIAL_DURATION_MINUTES: '90' }),
    )
  })

  it('falls back to 30 minutes when the offering was withdrawn while pending', async () => {
    // Blocking an approval an admin already decided on would be worse; the trial
    // is still torn down.
    const ctx = await setup()
    const order = await seedOrder(ctx.project.id, ctx.product.id, ctx.env.id, ctx.pm.id, {
      status: 'pending',
      isTrial: true,
    })

    const approvedAt = Date.now()
    const result = await approveOrder(makeSession(ctx.admin), order.id)
    expect(result.ok).toBe(true)

    const infra = await infraFor(order.id)
    const expiry = infra.scheduledDecommissionAt?.getTime() ?? 0
    expect(expiry).toBeGreaterThanOrEqual(approvedAt + 30 * 60_000)
  })

  it('leaves a non-trial approval unscheduled and un-flagged', async () => {
    const ctx = await buildTrial()
    const order = await seedOrder(ctx.project.id, ctx.product.id, ctx.env.id, ctx.pm.id, { status: 'pending' })

    await approveOrder(makeSession(ctx.admin), order.id)

    const infra = await infraFor(order.id)
    expect(infra.scheduledDecommissionAt).toBeNull()
    const vars = mockedWebhooks.mock.calls[0][2] as Record<string, string>
    expect(vars.TRIAL).toBeUndefined()
  })

  it('surfaces the trial flag in the approval queue', async () => {
    // It changes what the approver is agreeing to: a trial is torn down shortly
    // after it comes up and asks the pipeline for elevated rights inside it.
    const ctx = await buildTrial()
    await seedOrder(ctx.project.id, ctx.product.id, ctx.env.id, ctx.pm.id, { status: 'pending', isTrial: true })

    const result = await listApprovals()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data[0].isTrial).toBe(true)
  })
})
