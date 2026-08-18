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
import { orders, infrastructureElements, parameters } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  linkProductEnvironment,
  createOrder as seedOrder,
  createCostCenter,
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
  await linkProductEnvironment(product.id, env.id)
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
    await db.insert(parameters).values({
      scope: 'product',
      scopeId: product.id,
      name: 'FOO',
      type: 'string',
      required: false,
    })

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
    await db.insert(parameters).values({
      scope: 'product',
      scopeId: product.id,
      name: 'FOO',
      type: 'string',
      required: false,
    })

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

describe('createOrder — validation & ownership', () => {
  it('rejects a missing required parameter with 400', async () => {
    const { admin, cat, product, env, project } = await buildBase()
    await db.insert(parameters).values({
      scope: 'product',
      scopeId: product.id,
      name: 'HOSTNAME',
      type: 'string',
      required: true,
    })

    const result = await createOrder(makeSession(admin), {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      parameters: {},
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.message).toMatch(/HOSTNAME/)
    }
    void cat
  })

  it('rejects an empty string for a required parameter with 400', async () => {
    const { admin, product, env, project } = await buildBase()
    await db.insert(parameters).values({
      scope: 'product',
      scopeId: product.id,
      name: 'HOSTNAME',
      type: 'string',
      required: true,
    })

    const result = await createOrder(makeSession(admin), {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      parameters: { HOSTNAME: '   ' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('rejects a non-numeric value for a number parameter with 400', async () => {
    const { admin, product, env, project } = await buildBase()
    await db.insert(parameters).values({
      scope: 'product',
      scopeId: product.id,
      name: 'SIZE',
      type: 'number',
      required: false,
    })

    const result = await createOrder(makeSession(admin), {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      parameters: { SIZE: 'not-a-number' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('rejects a non-bool value for a bool parameter with 400', async () => {
    const { admin, product, env, project } = await buildBase()
    await db.insert(parameters).values({
      scope: 'product',
      scopeId: product.id,
      name: 'ENABLED',
      type: 'bool',
      required: false,
    })

    const result = await createOrder(makeSession(admin), {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      parameters: { ENABLED: 'yes' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('applies the default for an omitted optional parameter and drops unknown submitted keys', async () => {
    const { admin, product, env, project } = await buildBase()
    await db.insert(parameters).values({
      scope: 'product',
      scopeId: product.id,
      name: 'REGION',
      type: 'string',
      required: false,
      defaultValue: 'eu-west',
    })

    const result = await createOrder(makeSession(admin), {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      // FOO has no parameter definition — it must be dropped, not persisted.
      parameters: { FOO: 'bar' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [dbOrder] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(dbOrder.parameters).toEqual({ REGION: 'eu-west' })
    expect(dbOrder.parameters).not.toHaveProperty('FOO')
  })

  it('does not store submitted keys that have no parameter definition (CI-variable injection)', async () => {
    const { admin, product, env, project } = await buildBase()
    await db.insert(parameters).values({
      scope: 'product',
      scopeId: product.id,
      name: 'REGION',
      type: 'string',
      required: false,
      defaultValue: 'eu-west',
    })

    const result = await createOrder(makeSession(admin), {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      // Attempt to inject synthetic trigger vars with no definition.
      parameters: { REGION: 'us-east', REF: 'attacker-branch', TF_ACTION: 'destroy' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [dbOrder] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(dbOrder.parameters).toEqual({ REGION: 'us-east' })
    expect(dbOrder.parameters).not.toHaveProperty('REF')
    expect(dbOrder.parameters).not.toHaveProperty('TF_ACTION')

    // And they must not reach the CI trigger layer either.
    const [, , vars] = mockedTriggerWebhooks.mock.calls[0]
    expect(vars).not.toHaveProperty('REF')
    expect(vars).not.toHaveProperty('TF_ACTION')
  })

  it('trims surrounding whitespace before validating and storing values', async () => {
    const { admin, product, env, project } = await buildBase()
    await db.insert(parameters).values([
      { scope: 'product', scopeId: product.id, name: 'SIZE', type: 'number', required: true },
      { scope: 'product', scopeId: product.id, name: 'ENABLED', type: 'bool', required: true },
    ])

    const result = await createOrder(makeSession(admin), {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      // Padded values must be accepted (not rejected) and persisted trimmed so
      // the whitespace never reaches the CI trigger variables.
      parameters: { SIZE: ' 4 ', ENABLED: ' true ' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [dbOrder] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(dbOrder.parameters).toMatchObject({ SIZE: '4', ENABLED: 'true' })
  })

  it('accepts valid required + typed parameters (happy path)', async () => {
    const { admin, product, env, project } = await buildBase()
    await db.insert(parameters).values([
      { scope: 'product', scopeId: product.id, name: 'HOSTNAME', type: 'string', required: true },
      { scope: 'product', scopeId: product.id, name: 'SIZE', type: 'number', required: true },
      { scope: 'product', scopeId: product.id, name: 'ENABLED', type: 'bool', required: false },
    ])

    const result = await createOrder(makeSession(admin), {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      parameters: { HOSTNAME: 'web-01', SIZE: '4', ENABLED: 'true' },
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.status).toBe('provisioning')
  })

  it('returns 403 when a PM orders into another PM\'s project', async () => {
    const { product, env } = await buildBase()
    const otherPm = await createUser({ role: 'project_manager', email: 'other-pm@test.dev' })
    const foreignProject = await createProject(otherPm.id)
    const attacker = await createUser({ role: 'project_manager', email: 'attacker@test.dev' })

    const result = await createOrder(makeSession(attacker), {
      projectId: foreignProject.id,
      productId: product.id,
      environmentId: env.id,
      parameters: {},
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('returns 400 when the product is not offered in the chosen environment', async () => {
    const { admin, cat, project } = await buildBase()
    const unofferedProduct = await createProduct(cat.id, 'Unoffered')
    // Create a second environment the product is NOT linked to
    const ci = await createCiSource({ name: 'CI2' })
    const otherEnv = await createEnvironment(ci.id)

    const result = await createOrder(makeSession(admin), {
      projectId: project.id,
      productId: unofferedProduct.id,
      environmentId: otherEnv.id,
      parameters: {},
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })
})

// FA-10.4 / issue #22. These rules live on the product/environment offering and
// used to be enforced only by OrderForm in the browser, so a direct POST could
// bypass them entirely — and the result lands in billing attribution.
describe('createOrder — cost centre rules are enforced server-side', () => {
  const buildWith = async (
    mode: 'project' | 'select' | 'overhead',
    forced: boolean,
    overheadCostCenterId?: number | null,
  ) => {
    const admin = await createUser({ role: 'admin', email: 'cc-admin@test.dev' })
    const pm = await createUser({ role: 'project_manager', email: 'cc-pm@test.dev' })
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'CC Product')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await linkProductEnvironment(product.id, env.id, {
      costCenterMode: mode,
      forcedCostCenter: forced,
      ...(overheadCostCenterId !== undefined ? { overheadCostCenterId } : {}),
    })
    const project = await createProject(pm.id)
    return { admin, product, env, project }
  }

  const base = (p: { product: { id: number }; env: { id: number }; project: { id: number } }) => ({
    projectId: p.project.id,
    productId: p.product.id,
    environmentId: p.env.id,
    parameters: {},
  })

  it('rejects an order with no cost centre when the environment forces one', async () => {
    const ctx = await buildWith('select', true)
    const result = await createOrder(makeSession(ctx.admin), base(ctx))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.message).toMatch(/cost center is required/i)
    }
  })

  it('rejects a cost centre that has been deactivated', async () => {
    const ctx = await buildWith('select', true)
    const cc = await createCostCenter({ active: false })
    const result = await createOrder(makeSession(ctx.admin), { ...base(ctx), costCenterId: cc.id })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.message).toMatch(/not active/i)
    }
  })

  it('rejects a cost centre id that does not exist', async () => {
    const ctx = await buildWith('select', true)
    const result = await createOrder(makeSession(ctx.admin), { ...base(ctx), costCenterId: 999_999 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('stores an active cost centre when the environment asks the user to choose', async () => {
    const ctx = await buildWith('select', true)
    const cc = await createCostCenter()
    const result = await createOrder(makeSession(ctx.admin), { ...base(ctx), costCenterId: cc.id })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [row] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(row.costCenterId).toBe(cc.id)
  })

  it('allows omitting the cost centre when selection is offered but not forced', async () => {
    const ctx = await buildWith('select', false)
    const result = await createOrder(makeSession(ctx.admin), base(ctx))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [row] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(row.costCenterId).toBeNull()
  })

  it('ignores a submitted cost centre in project mode, where attribution follows the project', async () => {
    const ctx = await buildWith('project', false)
    const cc = await createCostCenter()
    const result = await createOrder(makeSession(ctx.admin), { ...base(ctx), costCenterId: cc.id })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [row] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    // The UI never offers the field in this mode, so a value that arrives anyway
    // must not be stored against the order.
    expect(row.costCenterId).toBeNull()
  })

  // ── overhead mode (issue #22) ───────────────────────────────────────────────
  // Before product_environments carried an account to point at, `overhead` fell
  // through to the same branch as `select` and asked the user to pick — the
  // opposite of a fixed shared account.
  it('bills an overhead order to the account configured on the offering', async () => {
    const overhead = await createCostCenter({ code: 'CC-OVERHEAD' })
    const ctx = await buildWith('overhead', true, overhead.id)

    const result = await createOrder(makeSession(ctx.admin), base(ctx))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [row] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(row.costCenterId).toBe(overhead.id)
  })

  it('ignores a submitted cost centre in overhead mode', async () => {
    const overhead = await createCostCenter({ code: 'CC-OVERHEAD' })
    const submitted = await createCostCenter({ code: 'CC-USER-PICKED' })
    const ctx = await buildWith('overhead', true, overhead.id)

    const result = await createOrder(makeSession(ctx.admin), { ...base(ctx), costCenterId: submitted.id })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [row] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    // The account is fixed by the offering — a caller cannot redirect the spend.
    expect(row.costCenterId).toBe(overhead.id)
  })

  it('rejects a forced overhead order when no account is configured', async () => {
    const ctx = await buildWith('overhead', true, null)
    const result = await createOrder(makeSession(ctx.admin), base(ctx))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.message).toMatch(/no overhead cost center is configured/i)
    }
  })

  it('records no cost centre when an unforced overhead offering has no account', async () => {
    const ctx = await buildWith('overhead', false, null)
    const result = await createOrder(makeSession(ctx.admin), base(ctx))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [row] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(row.costCenterId).toBeNull()
  })

  it('rejects an overhead account that has since been deactivated', async () => {
    // The offering was configured while the account was live; deactivating it
    // must stop new spend rather than silently attributing to a dead account.
    const overhead = await createCostCenter({ code: 'CC-OVERHEAD', active: false })
    const ctx = await buildWith('overhead', true, overhead.id)

    const result = await createOrder(makeSession(ctx.admin), base(ctx))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.message).toMatch(/overhead cost center is not active/i)
    }
  })
})
