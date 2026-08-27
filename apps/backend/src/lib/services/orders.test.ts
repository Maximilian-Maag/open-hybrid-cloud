import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionUser } from '@open-hybrid-cloud/types'

vi.mock('@/lib/notification', () => ({
  sendOrderCreated: vi.fn().mockResolvedValue(undefined),
  sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ci/webhooks', () => ({
  triggerProductWebhooksTracked: vi.fn().mockResolvedValue({ pipelineIds: ['pipe-1'], failures: [] }),
  triggerPipelineStacksTracked: vi.fn().mockResolvedValue({ pipelineIds: [], failures: [] }),
}))

import { listOrders, getOrderById, createOrder, markOrderFailed, STUCK_ORDER_SILENCE_MS } from './orders'
import { sendOrderCreated, sendApprovalRequest } from '@/lib/notification'
import { triggerProductWebhooksTracked, triggerPipelineStacksTracked } from '@/lib/ci/webhooks'
import { db } from '@/lib/db/client'
import { orders, infrastructureElements, parameters, productEnvironments, auditLog } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  linkProductEnvironment,
  createOrder as seedOrder,
  createInfraElement,
  createCostCenter,
  createDelegation as seedDelegation,
} from '@/test/helpers'

const makeSession = (u: { id: number; email: string; name: string; role: string }): SessionUser =>
  ({ id: u.id, email: u.email, name: u.name, role: u.role as SessionUser['role'] })

const mockedTriggerWebhooks = vi.mocked(triggerProductWebhooksTracked)
const mockedTriggerStacks = vi.mocked(triggerPipelineStacksTracked)
const mockedSendOrderCreated = vi.mocked(sendOrderCreated)
const mockedSendApprovalRequest = vi.mocked(sendApprovalRequest)

beforeEach(() => {
  mockedTriggerWebhooks.mockReset().mockResolvedValue({ pipelineIds: ['pipe-1'], failures: [] })
  mockedTriggerStacks.mockReset().mockResolvedValue({ pipelineIds: [], failures: [] })
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

  // The webhook handler has written `orders.pipeline_status` since #133 and this
  // projection never selected it, so the order detail page listed pipeline ids
  // with nothing beside them — a run that looks like it never reported.
  it('returns the per-pipeline status the webhook handler recorded', async () => {
    const { admin, pm, product, env, project } = await buildBase()
    const order = await seedOrder(project.id, product.id, env.id, pm.id, {
      pipelineId: ['pipe-a', 'pipe-b'],
    })
    await db
      .update(orders)
      .set({ pipelineStatus: { 'pipe-a': 'success', 'pipe-b': 'failed' } })
      .where(eq(orders.id, order.id))

    const result = await getOrderById(makeSession(admin), order.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.pipelineStatus).toEqual({ 'pipe-a': 'success', 'pipe-b': 'failed' })
    }
  })

  it('reports an empty status map rather than undefined for an order with no pipelines', async () => {
    // The page renders "pending" per id from an absent key; an undefined map
    // would make that a crash instead.
    const { admin, pm, product, env, project } = await buildBase()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)

    const result = await getOrderById(makeSession(admin), order.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.pipelineStatus).toEqual({})
  })

  // Terraform outputs live on the ELEMENT, and the order had no route to them:
  // you had to know to go to Infrastructure and find the right row.
  it('returns the order\'s elements, with their Terraform outputs', async () => {
    const { admin, pm, product, env, project } = await buildBase()
    const order = await seedOrder(project.id, product.id, env.id, pm.id, { quantity: 2 })
    await createInfraElement(order.id, project.id, env.id, product.id, {
      sequence: 1,
      outputs: { endpoint: 'https://vm-1.example.com', ip: '10.0.0.1' },
    })
    await createInfraElement(order.id, project.id, env.id, product.id, {
      sequence: 2,
      outputs: { endpoint: 'https://vm-2.example.com' },
    })

    const result = await getOrderById(makeSession(admin), order.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // In sequence order, because "the order's second element" has to mean the
    // same thing here as it does everywhere else.
    expect(result.data.elements?.map((e) => e.sequence)).toEqual([1, 2])
    expect(result.data.elements?.[0].outputs).toEqual({
      endpoint: 'https://vm-1.example.com',
      ip: '10.0.0.1',
    })
    expect(result.data.elements?.[1].outputs).toEqual({ endpoint: 'https://vm-2.example.com' })
  })

  it('returns an empty element list for an order that has provisioned nothing', async () => {
    const { admin, pm, product, env, project } = await buildBase()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)

    const result = await getOrderById(makeSession(admin), order.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.elements).toEqual([])
  })

  it('does not carry elements on the list endpoint', async () => {
    // One query per row for something the list does not render. If this ever
    // needs them, it needs a join, not N+1.
    const { admin, pm, product, env, project } = await buildBase()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    await createInfraElement(order.id, project.id, env.id, product.id, {
      outputs: { endpoint: 'https://vm.example.com' },
    })

    const result = await listOrders(makeSession(admin))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.find((o) => o.id === order.id)?.elements).toBeUndefined()
  })

  it('still gives a project manager their own order, elements and all', async () => {
    const { pm, product, env, project } = await buildBase()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    await createInfraElement(order.id, project.id, env.id, product.id, {
      outputs: { endpoint: 'https://vm.example.com' },
    })

    const result = await getOrderById(makeSession(pm), order.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.elements?.[0].outputs).toEqual({ endpoint: 'https://vm.example.com' })
    }
  })
})

describe('createOrder (admin path)', () => {
  it('creates order with status provisioning, triggers webhooks with ORDER_ID, creates infra, notifies, returns infraId', async () => {
    const { admin, product, env, project } = await buildBase()
    mockedTriggerWebhooks.mockResolvedValueOnce({ pipelineIds: ['pipe-admin-1'], failures: [] })
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

  it('places an order for a REQUIRED sensitive parameter that has a stored default', async () => {
    const { admin, product, env, project } = await buildBase()
    await db.insert(parameters).values({
      scope: 'product',
      scopeId: product.id,
      name: 'API_KEY',
      type: 'string',
      required: true,
      sensitive: true,
      defaultValue: 'the-real-secret',
    })

    // The form is never shown this value, so it can only send back the sentinel
    // or nothing. Checking `required` before applying the default made such a
    // product impossible to order: the server had the value and refused to use it.
    const submissions: Record<string, string>[] = [{}, { API_KEY: '[redacted]' }]
    for (const submitted of submissions) {
      const result = await createOrder(makeSession(admin), {
        projectId: project.id,
        productId: product.id,
        environmentId: env.id,
        parameters: submitted,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      const [dbOrder] = await db.select().from(orders).where(eq(orders.id, result.data.id))
      expect(dbOrder.parameters).toEqual({ API_KEY: 'the-real-secret' })
    }
  })

  /*
   * A product is provisioned by a webhook or a pipeline stack, per environment.
   * With neither, `provisionOrderElements` starts nothing, notices, deletes the
   * element rows it just wrote and answers 502 "Could not start the deployment"
   * — which reads as "CI is down" when the truth is "nobody configured a
   * pipeline". An imported Kubernetes product was found in exactly that state:
   * catalogued, parameters imported, a full order form, and a 502 at the till.
   */
  it('refuses a product with nothing to provision it, before the order exists', async () => {
    const admin = await createUser({ role: 'admin', email: 'nodeploy@test.dev' })
    const pm = await createUser({ role: 'project_manager', email: 'nodeploy-pm@test.dev' })
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'Undeployable')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    // Offered, but with no webhook and no pipeline stack.
    await linkProductEnvironment(product.id, env.id, { deployable: false })
    const project = await createProject(pm.id)

    const result = await createOrder(makeSession(admin), {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      parameters: {},
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    // 409 and not 502: nothing failed, the product is not set up.
    expect(result.status).toBe(409)
    expect(result.message).toMatch(/no pipeline configured/i)
    // It says who has to fix it and what they have to add.
    expect(result.message).toMatch(/administrator/i)
    expect(result.message).toMatch(/pipeline stack or a webhook/i)

    // And no order row was written, so there is nothing to roll back.
    expect(await db.select().from(orders).where(eq(orders.productId, product.id))).toEqual([])
  })

  it('still refuses a required parameter that has no default to fall back on', async () => {
    const { admin, product, env, project } = await buildBase()
    await db.insert(parameters).values({
      scope: 'product',
      scopeId: product.id,
      name: 'REGION',
      type: 'string',
      required: true,
      defaultValue: '',
    })

    const result = await createOrder(makeSession(admin), {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      parameters: {},
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/Missing required parameter: REGION/)
  })

  it('treats the redaction sentinel as "unchanged", not as the value (#131)', async () => {
    const { admin, product, env, project } = await buildBase()
    await db.insert(parameters).values({
      scope: 'product',
      scopeId: product.id,
      name: 'API_KEY',
      type: 'string',
      required: false,
      sensitive: true,
      defaultValue: 'the-real-secret',
    })

    // Reads are redacted, so the reorder and apply-template prefills hand the
    // form '[redacted]' for every sensitive parameter. Posting that back must
    // not overwrite the stored secret with the placeholder — and must not ship
    // the placeholder to the pipeline as a trigger variable.
    const result = await createOrder(makeSession(admin), {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      parameters: { API_KEY: '[redacted]' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [dbOrder] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(dbOrder.parameters).toEqual({ API_KEY: 'the-real-secret' })
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

  it('does not let a parameter DEFINITION named REF choose the git ref (issue #183)', async () => {
    const { admin, product, env, project } = await buildBase()
    // The definition exists — an admin created it, or `sync-parameters` imported
    // it from a template's variables.tf. Dropping keys with no definition, which
    // is what the previous test covers, protects nothing against this: the key
    // has one.
    await db.insert(parameters).values([
      { scope: 'product', scopeId: product.id, name: 'REF', type: 'string', required: false },
      { scope: 'product', scopeId: product.id, name: 'TF_ACTION', type: 'string', required: false },
      { scope: 'product', scopeId: product.id, name: 'hostname', type: 'string', required: false },
    ])

    const result = await createOrder(makeSession(admin), {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      parameters: { REF: 'attacker/branch', TF_ACTION: 'destroy', hostname: 'web-01' },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // `triggerGitLabPipeline` reads variables['REF'] as the git ref it runs, so
    // this is the difference between the pipeline running main and running
    // whatever the orderer pushed, with the environment's trigger token.
    const [, , vars] = mockedTriggerWebhooks.mock.calls[0]
    expect(vars).not.toHaveProperty('REF')
    expect(vars).not.toHaveProperty('TF_ACTION')
    expect(vars).toMatchObject({ hostname: 'web-01' })

    // And it is not persisted either, so approving a pending order months later
    // cannot replay it.
    const [dbOrder] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(dbOrder.parameters).toEqual({ hostname: 'web-01' })
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

// Issue #1: "test a 1ClickApp for 30 minutes with Admin priv". "Admin priv" is
// elevated rights INSIDE the provisioned app — the portal cannot grant rights in
// somebody else's Terraform, so it passes the intent to CI. A trial therefore does
// NOT bypass approval; that would make every trial-enabled product a way around
// the approval workflow entirely.
describe('createOrder — time-boxed trials', () => {
  const buildTrial = async (over?: { trialEnabled?: boolean; trialDurationMinutes?: number }) => {
    const admin = await createUser({ role: 'admin', email: 'trial-admin@test.dev' })
    const pm = await createUser({ role: 'project_manager', email: 'trial-pm@test.dev' })
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'OneClick App')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    await linkProductEnvironment(product.id, env.id, over)
    const project = await createProject(pm.id)
    return {
      admin,
      pm,
      base: { projectId: project.id, productId: product.id, environmentId: env.id, parameters: {} },
    }
  }

  it('refuses a trial of an offering that has not opted in', async () => {
    // The toggle is hidden in the browser for such products, and a hidden control
    // is not a control.
    const { admin, base } = await buildTrial()
    const result = await createOrder(makeSession(admin), { ...base, trial: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.message).toMatch(/not available as a trial/i)
    }
  })

  it('still allows a normal order of a trial-enabled offering', async () => {
    const { admin, base } = await buildTrial({ trialEnabled: true })
    const result = await createOrder(makeSession(admin), base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [row] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(row.isTrial).toBe(false)
  })

  it('marks the order and schedules the teardown for an admin trial', async () => {
    const { admin, base } = await buildTrial({ trialEnabled: true, trialDurationMinutes: 30 })
    const before = Date.now()
    const result = await createOrder(makeSession(admin), { ...base, trial: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [order] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(order.isTrial).toBe(true)

    const [infra] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.orderId, order.id))
    // The scheduled-decommission sweep (issue #30) is what tears it down, so a
    // trial needs no expiry mechanism of its own.
    const expiry = infra.scheduledDecommissionAt?.getTime() ?? 0
    expect(expiry).toBeGreaterThanOrEqual(before + 30 * 60_000)
    expect(expiry).toBeLessThanOrEqual(Date.now() + 30 * 60_000)
  })

  it('honours a configured duration other than 30 minutes', async () => {
    const { admin, base } = await buildTrial({ trialEnabled: true, trialDurationMinutes: 120 })
    const before = Date.now()
    const result = await createOrder(makeSession(admin), { ...base, trial: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [infra] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.orderId, result.data.id))
    expect(infra.scheduledDecommissionAt?.getTime()).toBeGreaterThanOrEqual(before + 120 * 60_000)
  })

  it('passes the trial variables to CI', async () => {
    const { admin, base } = await buildTrial({ trialEnabled: true, trialDurationMinutes: 45 })
    await createOrder(makeSession(admin), { ...base, trial: true })

    expect(mockedTriggerWebhooks).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ TRIAL: 'true', TRIAL_DURATION_MINUTES: '45' }),
      // The recorder that stores each pipeline id as it starts (issue #132).
      expect.any(Function),
    )
  })

  it('sends no trial variables for an ordinary order', async () => {
    const { admin, base } = await buildTrial({ trialEnabled: true })
    await createOrder(makeSession(admin), base)

    const vars = mockedTriggerWebhooks.mock.calls[0][2] as Record<string, string>
    expect(vars.TRIAL).toBeUndefined()
    expect(vars.TRIAL_DURATION_MINUTES).toBeUndefined()
  })

  it('leaves an ordinary order with no teardown schedule', async () => {
    const { admin, base } = await buildTrial({ trialEnabled: true })
    const result = await createOrder(makeSession(admin), base)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [infra] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.orderId, result.data.id))
    expect(infra.scheduledDecommissionAt).toBeNull()
  })

  it('does NOT bypass approval for a project manager', async () => {
    // Self-service trials would turn every trial-enabled product into a way around
    // the approval workflow.
    const { pm, base } = await buildTrial({ trialEnabled: true })
    const result = await createOrder(makeSession(pm), { ...base, trial: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [order] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(order.status).toBe('pending')
    expect(order.isTrial).toBe(true)
    // Nothing is provisioned yet, so nothing is scheduled yet either.
    const infra = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.orderId, order.id))
    expect(infra).toHaveLength(0)
  })
})

// Issue #38. Orders reference the product by id, so without a snapshot a later
// price change silently rewrites what the order detail page reports as approved.
describe('createOrder — product snapshot', () => {
  const buildSnapshot = async () => {
    const admin = await createUser({ role: 'admin', email: 'snap-admin@test.dev' })
    const pm = await createUser({ role: 'project_manager', email: 'snap-pm@test.dev' })
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'Nginx Gateway')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id, undefined, 'AWS Frankfurt')
    await linkProductEnvironment(product.id, env.id, { price: '10.00', currency: 'CHF' })
    const project = await createProject(pm.id)
    return {
      admin,
      pm,
      product,
      env,
      base: { projectId: project.id, productId: product.id, environmentId: env.id, parameters: {} },
    }
  }

  it('stores what was offered on an admin order', async () => {
    const ctx = await buildSnapshot()
    const result = await createOrder(makeSession(ctx.admin), ctx.base)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [row] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(row.productSnapshot).toMatchObject({
      version: 1,
      productName: 'Nginx Gateway',
      environmentName: 'AWS Frankfurt',
      price: '10.00',
      currency: 'CHF',
    })
  })

  it('stores it on a pending order too, at order time', async () => {
    // The snapshot has to be what the customer SAW, so it is taken when the order
    // is placed rather than when it is approved.
    const ctx = await buildSnapshot()
    const result = await createOrder(makeSession(ctx.pm), ctx.base)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [row] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(row.status).toBe('pending')
    expect(row.productSnapshot?.price).toBe('10.00')
  })

  it('is unaffected by a later price change', async () => {
    // This is the whole point: the order keeps reporting the price it was placed at.
    const ctx = await buildSnapshot()
    const result = await createOrder(makeSession(ctx.admin), ctx.base)
    if (!result.ok) throw new Error('setup failed')

    await linkProductEnvironment(ctx.product.id, ctx.env.id, { price: '99.00' })
    await db
      .update(productEnvironments)
      .set({ price: '99.00' })
      .where(eq(productEnvironments.productId, ctx.product.id))

    const [row] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    expect(row.productSnapshot?.price).toBe('10.00')
  })

  it('records the parameter definitions that applied', async () => {
    const ctx = await buildSnapshot()
    await db.insert(parameters).values({
      scope: 'product', scopeId: ctx.product.id, name: 'REGION', type: 'string', defaultValue: 'eu-central-1',
    })

    const result = await createOrder(makeSession(ctx.admin), {
      ...ctx.base,
      parameters: { REGION: 'eu-west-1' },
    })
    if (!result.ok) throw new Error('setup failed')

    const [row] = await db.select().from(orders).where(eq(orders.id, result.data.id))
    // The DEFINITION, with its default — the submitted value lives in `parameters`.
    expect(row.productSnapshot?.parameters).toMatchObject([{ name: 'REGION', defaultValue: 'eu-central-1' }])
    expect(row.parameters).toEqual({ REGION: 'eu-west-1' })
  })

  it('surfaces the snapshot on the order read paths', async () => {
    const ctx = await buildSnapshot()
    const created = await createOrder(makeSession(ctx.admin), ctx.base)
    if (!created.ok) throw new Error('setup failed')

    const detail = await getOrderById(makeSession(ctx.admin), created.data.id)
    expect(detail.ok && detail.data.productSnapshot?.price).toBe('10.00')

    const listed = await listOrders(makeSession(ctx.admin))
    expect(listed.ok && listed.data[0].productSnapshot?.price).toBe('10.00')
  })
})

// Issue #35. Delegation is reflected in the approval-request email as a CC, not a
// redirect: nobody is removed from the recipient list, and the substitute's copy
// gains the names of the admins they are covering for.
describe('createOrder — delegation in the approval-request email', () => {
  it('annotates the substitute’s copy and leaves the away admin on the list', async () => {
    const { pm, product, env, project } = await buildBase()
    const away = await createUser({ role: 'admin', email: 'away@test.dev', name: 'Away Admin' })
    const sub = await createUser({ role: 'admin', email: 'sub@test.dev', name: 'Sub Admin' })
    await seedDelegation(away.id, sub.id, { startsInDays: 0, endsInDays: 5 })

    const result = await createOrder(makeSession(pm), {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      parameters: {},
    })
    expect(result.ok).toBe(true)

    const byRecipient = new Map(
      mockedSendApprovalRequest.mock.calls.map((c) => [c[0] as string, c[4] as string[]]),
    )
    // The away admin is still notified — a redirect would have made approval
    // traffic invisible to the admin who remains accountable for it.
    expect(byRecipient.has('away@test.dev')).toBe(true)
    expect(byRecipient.get('away@test.dev')).toEqual([])
    expect(byRecipient.get('sub@test.dev')).toEqual(['Away Admin'])
  })

  it('annotates nobody when no delegation is in force', async () => {
    const { pm, product, env, project } = await buildBase()
    await createUser({ role: 'admin', email: 'other@test.dev', name: 'Other' })

    await createOrder(makeSession(pm), {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      parameters: {},
    })

    for (const call of mockedSendApprovalRequest.mock.calls) {
      expect(call[4]).toEqual([])
    }
  })

  it('ignores a delegation whose period has passed', async () => {
    const { pm, product, env, project } = await buildBase()
    const away = await createUser({ role: 'admin', email: 'away@test.dev', name: 'Away Admin' })
    const sub = await createUser({ role: 'admin', email: 'sub@test.dev', name: 'Sub Admin' })
    await seedDelegation(away.id, sub.id, { startsInDays: -9, endsInDays: -2 })

    await createOrder(makeSession(pm), {
      projectId: project.id,
      productId: product.id,
      environmentId: env.id,
      parameters: {},
    })

    const subCall = mockedSendApprovalRequest.mock.calls.find((c) => c[0] === 'sub@test.dev')
    expect(subCall?.[4]).toEqual([])
  })
})

/**
 * Issue #206. A product with no webhook and no pipeline stack for the environment
 * starts nothing and fails at nothing, so the "nothing started" guard — which
 * used to require `failures.length > 0` — never fired. The run closed cleanly
 * with an empty id list, `isSettled` refused it (rightly: nothing reported
 * success), and the order sat in 'provisioning' with nothing in existence that
 * could ever move it.
 */
describe('an order whose triggers fire nothing (#206)', () => {
  beforeEach(() => {
    mockedTriggerWebhooks.mockResolvedValue({ pipelineIds: [], failures: [] })
    mockedTriggerStacks.mockResolvedValue({ pipelineIds: [], failures: [] })
  })

  it('is refused rather than left provisioning forever', async () => {
    const ctx = await buildBase()
    const result = await createOrder(makeSession(ctx.admin), {
      projectId: ctx.project.id,
      productId: ctx.product.id,
      environmentId: ctx.env.id,
      parameters: {},
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(502)
  })

  it('says what is actually wrong, not "could not start any pipeline: "', async () => {
    // The old message interpolated an empty failure list, which told an operator
    // nothing. This is a misconfiguration and the fix is in Admin → Products.
    const ctx = await buildBase()
    const result = await createOrder(makeSession(ctx.admin), {
      projectId: ctx.project.id,
      productId: ctx.product.id,
      environmentId: ctx.env.id,
      parameters: {},
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toMatch(/no product webhook and no pipeline stack/i)
      expect(result.message).not.toMatch(/Could not start any pipeline:\s*$/)
    }
  })

  it('leaves no order claiming to be provisioning', async () => {
    const ctx = await buildBase()
    await createOrder(makeSession(ctx.admin), {
      projectId: ctx.project.id,
      productId: ctx.product.id,
      environmentId: ctx.env.id,
      parameters: {},
    })

    const rows = await db.select().from(orders).where(eq(orders.projectId, ctx.project.id))
    expect(rows.every((o) => o.status !== 'provisioning')).toBe(true)
  })

  it('leaves no infrastructure element behind', async () => {
    // They are inserted before their triggers fire. Left in place they are
    // 'active' elements with no pipeline: counted in inventory, and
    // decommissioning them fires destroy at infrastructure never created.
    const ctx = await buildBase()
    await createOrder(makeSession(ctx.admin), {
      projectId: ctx.project.id,
      productId: ctx.product.id,
      environmentId: ctx.env.id,
      parameters: {},
      quantity: 3,
    })

    const rows = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.projectId, ctx.project.id))
    expect(rows).toHaveLength(0)
  })

  it('still reports the failures when there were some', async () => {
    // The other half of the same guard must keep its own message.
    mockedTriggerWebhooks.mockResolvedValue({ pipelineIds: [], failures: ['webhook #1: 502'] })
    const ctx = await buildBase()
    const result = await createOrder(makeSession(ctx.admin), {
      projectId: ctx.project.id,
      productId: ctx.product.id,
      environmentId: ctx.env.id,
      parameters: {},
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/webhook #1: 502/)
  })
})

/**
 * Issue #208. The orders table has had a Project column all along, reading a
 * field on the shared `Order` type that neither projection ever selected — so the
 * cell was blank and the detail page fell back to `#12`.
 *
 * These assert on the NAME rather than on the query succeeding, which is the
 * whole point: every existing test passed with the field permanently undefined.
 */
describe('the project name (#208)', () => {
  it('is on the list', async () => {
    const { admin, pm, product, env, project } = await buildBase()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)

    const result = await listOrders(makeSession(admin))
    expect(result.ok).toBe(true)
    if (result.ok) {
      const row = result.data.find((o) => o.id === order.id)
      expect(row?.projectName).toBe(project.name)
    }
  })

  it('is on the detail', async () => {
    const { admin, pm, product, env, project } = await buildBase()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)

    const result = await getOrderById(makeSession(admin), order.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.projectName).toBe(project.name)
  })

  it('is a name, not the id it used to fall back to', async () => {
    const { admin, pm, product, env, project } = await buildBase()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)

    const result = await getOrderById(makeSession(admin), order.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.projectName).not.toBeUndefined()
      expect(result.data.projectName).not.toBe(`#${project.id}`)
    }
  })

  it('reaches a project manager looking at their own order', async () => {
    // The join must not depend on being an admin: the list is filtered by owner
    // for a project manager, and the name has to survive that.
    const { pm, product, env, project } = await buildBase()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)

    const result = await listOrders(makeSession(pm))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.find((o) => o.id === order.id)?.projectName).toBe(project.name)
    }
  })
})

// An order that reaches `provisioning` and never hears back from CI had no way
// out: Retry is gated on `failed`, which the order can only reach through a
// callback that is not coming. Seen live as order 37 on the dev instance —
// provisioning since 24 August, `updated_at` 0.6s after `created_at`,
// `pipeline_status` empty.
describe('markOrderFailed (issue #206)', () => {
  const LONG_AGO = new Date(Date.now() - 90 * 60 * 1000)

  async function stuckOrder(status = 'provisioning', updatedAt: Date = LONG_AGO) {
    const owner = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await createProject(owner.id)
    const order = await seedOrder(project.id, product.id, env.id, owner.id, { status })
    await db.update(orders).set({ updatedAt }).where(eq(orders.id, order.id))
    return order
  }

  it('lets root write off an order that has gone silent', async () => {
    const root = await createUser({ role: 'root' })
    const order = await stuckOrder()

    const result = await markOrderFailed(makeSession(root), order.id, 'Pipeline 740 finished; no callback arrived.')

    expect(result.ok).toBe(true)
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(row.status).toBe('failed')
  })

  // The whole point is that a person took responsibility for a status nothing
  // observed, so the entry has to say who and why.
  it('records who wrote it off and the reason they gave', async () => {
    const root = await createUser({ role: 'root' })
    const order = await stuckOrder()

    await markOrderFailed(makeSession(root), order.id, 'Pipeline finished in GitLab, callback never arrived.')

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'order.written_off'))
      .orderBy(desc(auditLog.id))
      .limit(1)
    expect(entry.userId).toBe(root.id)
    expect(entry.entityId).toBe(order.id)
    expect(entry.details).toContain(root.email)
    expect(entry.details).toContain('callback never arrived')
    expect(entry.details).toMatch(/\d+ minutes/)
  })

  it('refuses anyone who is not root', async () => {
    const admin = await createUser({ role: 'admin' })
    const order = await stuckOrder()

    const result = await markOrderFailed(makeSession(admin), order.id, 'let me')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(row.status).toBe('provisioning')
  })

  // Every other status either resolves itself or has its own way out; this exists
  // only for the one that does not.
  it.each(['pending', 'completed', 'failed', 'rejected'])(
    'refuses to touch an order that is %s',
    async (status) => {
      const root = await createUser({ role: 'root' })
      const order = await stuckOrder(status)

      const result = await markOrderFailed(makeSession(root), order.id, 'reason')

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    },
  )

  // A pipeline that is merely slow must not be written off out from under itself.
  it('refuses while the order could still be running', async () => {
    const root = await createUser({ role: 'root' })
    const order = await stuckOrder('provisioning', new Date(Date.now() - 60 * 1000))

    const result = await markOrderFailed(makeSession(root), order.id, 'impatient')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.message).toMatch(/may still be running/i)
    }
  })

  it('accepts it the moment the silence is long enough', async () => {
    const root = await createUser({ role: 'root' })
    const order = await stuckOrder('provisioning', new Date(Date.now() - STUCK_ORDER_SILENCE_MS - 1000))

    const result = await markOrderFailed(makeSession(root), order.id, 'no callback')

    expect(result.ok).toBe(true)
  })

  it('insists on a reason', async () => {
    const root = await createUser({ role: 'root' })
    const order = await stuckOrder()

    const result = await markOrderFailed(makeSession(root), order.id, '   ')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('answers 404 for an order that is not there', async () => {
    const root = await createUser({ role: 'root' })
    const result = await markOrderFailed(makeSession(root), 999_999, 'reason')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  // The UPDATE carries the status in its WHERE, so a callback that lands between
  // the read and the write wins rather than being overwritten by the write-off.
  it('loses to a callback that arrives first', async () => {
    const root = await createUser({ role: 'root' })
    const order = await stuckOrder()
    await db.update(orders).set({ status: 'completed' }).where(eq(orders.id, order.id))

    const result = await markOrderFailed(makeSession(root), order.id, 'too late')

    expect(result.ok).toBe(false)
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(row.status).toBe('completed')
  })
})

// The order detail page printed `#3` where the cost centre belongs. An internal
// row id is the one form in which a finance reader cannot recognise the account
// their order was charged against.
describe('getOrderById cost centre naming', () => {
  async function orderWithCostCentre(costCenterId: number | null) {
    const owner = await createUser({ role: 'root' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const project = await createProject(owner.id)
    const order = await seedOrder(project.id, product.id, env.id, owner.id)
    await db.update(orders).set({ costCenterId }).where(eq(orders.id, order.id))
    return { owner, order }
  }

  it('answers with the code and the name, not just the id', async () => {
    const cc = await createCostCenter({ code: 'IT-4711', name: 'Platform Networking' })
    const { owner, order } = await orderWithCostCentre(cc.id)

    const result = await getOrderById(makeSession(owner), order.id)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.costCenterId).toBe(cc.id)
      expect(result.data.costCenterCode).toBe('IT-4711')
      expect(result.data.costCenterName).toBe('Platform Networking')
    }
  })

  // A cost centre is optional — see costCenterMode. Joining it must not make an
  // order without one vanish from its own detail page.
  it('still answers for an order that has no cost centre', async () => {
    const { owner, order } = await orderWithCostCentre(null)

    const result = await getOrderById(makeSession(owner), order.id)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.id).toBe(order.id)
      expect(result.data.costCenterId).toBeNull()
      expect(result.data.costCenterCode ?? null).toBeNull()
    }
  })

  // An inactive cost centre is still the one the order was charged against, and
  // the order has to keep reading correctly after an admin retires it.
  it('names a retired cost centre too', async () => {
    const cc = await createCostCenter({ code: 'OLD-1', name: 'Closed Department', active: false })
    const { owner, order } = await orderWithCostCentre(cc.id)

    const result = await getOrderById(makeSession(owner), order.id)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.costCenterCode).toBe('OLD-1')
  })
})
