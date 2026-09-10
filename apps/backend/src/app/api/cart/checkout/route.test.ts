import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/notification', () => ({
  sendOrderCreated: vi.fn().mockResolvedValue(undefined),
  sendApprovalRequest: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ci/webhooks', () => ({
  triggerProductWebhooks: vi.fn().mockResolvedValue(['pipe-1']),
  triggerPipelineStacks: vi.fn().mockResolvedValue([]),
  triggerProductWebhooksTracked: vi.fn().mockResolvedValue({ pipelineIds: ['pipe-1'], failures: [] }),
  triggerPipelineStacksTracked: vi.fn().mockResolvedValue({ pipelineIds: [], failures: [] }),
}))

import { NextRequest } from 'next/server'
import { POST } from './route'
import { db } from '@/lib/db/client'
import {
  auditLog,
  cartItems,
  infrastructureElements,
  orders,
  parameters,
  productEnvironments,
  products,
} from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { MAX_CART_ITEMS } from '@/lib/services/cart'
import {
  createUser,
  makeAuthHeader,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createCostCenter,
  linkProductEnvironment,
} from '@/test/helpers'

const req = (body?: unknown, auth?: string) =>
  new NextRequest('http://localhost/api/cart/checkout', {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(auth ? { headers: { authorization: auth, 'content-type': 'application/json' } } : {}),
  })

/** A raw request whose body is not JSON at all. */
const brokenBodyReq = (auth: string) =>
  new NextRequest('http://localhost/api/cart/checkout', {
    method: 'POST',
    body: 'not json',
    headers: { authorization: auth, 'content-type': 'application/json' },
  })

const seedCartItem = async (userId: number, productId: number, environmentId: number) => {
  const [item] = await db
    .insert(cartItems)
    .values({ userId, productId, environmentId, parameters: {} })
    .returning()
  return item
}

const setup = async () => {
  const pm = await createUser({ role: 'project_manager', email: 'co-pm@test.dev' })
  const otherPm = await createUser({ role: 'project_manager', email: 'co-other@test.dev' })
  const admin = await createUser({ role: 'admin', email: 'co-admin@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Nginx Gateway')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  await linkProductEnvironment(product.id, env.id, { price: '10.00' })
  const project = await createProject(pm.id, 'Webshop')
  const theirProject = await createProject(otherPm.id, 'Hidden')

  return {
    pm,
    otherPm,
    admin,
    product,
    env,
    project,
    theirProject,
    auth: await makeAuthHeader(pm),
    otherAuth: await makeAuthHeader(otherPm),
    adminAuth: await makeAuthHeader(admin),
  }
}

const checkout = (
  auth: string,
  projectId: number,
  items: { cartItemId: number; parameters?: Record<string, string>; costCenterId?: number; trial?: boolean }[],
) => POST(req({ projectId, items: items.map((i) => ({ parameters: {}, ...i })) }, auth))

describe('POST /api/cart/checkout', () => {
  it('returns 401 without a token', async () => {
    const { project } = await setup()
    const res = await POST(req({ projectId: project.id, items: [{ cartItemId: 1, parameters: {} }] }))
    expect(res.status).toBe(401)
  })

  it('is open to a project manager — ordering is not an admin feature', async () => {
    // No requireRole on this route by design: the approval workflow, not a role
    // gate, is what stands between a project manager and provisioned infrastructure.
    const { pm, product, env, project, auth } = await setup()
    const item = await seedCartItem(pm.id, product.id, env.id)

    const res = await checkout(auth, project.id, [{ cartItemId: item.id }])
    expect(res.status).toBe(201)

    const [order] = await db.select().from(orders)
    // Queued for approval rather than provisioned, and the cart item is consumed.
    expect(order.status).toBe('pending')
    expect(await db.select().from(infrastructureElements)).toHaveLength(0)
    expect(await db.select().from(cartItems)).toHaveLength(0)
  })

  it('provisions immediately for an admin, who needs no approval', async () => {
    const { admin, product, env, project, adminAuth } = await setup()
    const item = await seedCartItem(admin.id, product.id, env.id)

    const res = await checkout(adminAuth, project.id, [{ cartItemId: item.id }])
    expect(res.status).toBe(201)

    const [order] = await db.select().from(orders)
    expect(order.status).toBe('provisioning')
    expect(await db.select().from(infrastructureElements)).toHaveLength(1)
  })

  it('records the checkout in the audit log without pinning it to one order', async () => {
    // A checkout spans several orders, so no single entity id would be honest.
    const { pm, product, env, project, auth } = await setup()
    const a = await seedCartItem(pm.id, product.id, env.id)
    const b = await seedCartItem(pm.id, product.id, env.id)

    await checkout(auth, project.id, [{ cartItemId: a.id }, { cartItemId: b.id }])

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'cart.checked_out'))
    expect(entry.entityId).toBeNull()
    expect(entry.details).toContain('2 item(s)')
  })

  it('refuses a cart item that belongs to another user, and leaves it alone', async () => {
    // The ownership scope is the whole security boundary here: a cart item id is a
    // guessable integer, and an id from someone else's cart must not be orderable.
    const { otherPm, product, env, project, auth } = await setup()
    const theirs = await seedCartItem(otherPm.id, product.id, env.id)

    const res = await checkout(auth, project.id, [{ cartItemId: theirs.id }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('The cart changed')

    expect(await db.select().from(orders)).toHaveLength(0)
    expect(await db.select().from(cartItems).where(eq(cartItems.id, theirs.id))).toHaveLength(1)
  })

  it('refuses to order into a project the caller does not own', async () => {
    const { pm, product, env, theirProject, auth } = await setup()
    const item = await seedCartItem(pm.id, product.id, env.id)

    const res = await checkout(auth, theirProject.id, [{ cartItemId: item.id }])
    // The ownership check in prepareOrder is reached — its 403 is folded into the
    // all-or-nothing validation gate's 400, which is why the message matters here.
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Forbidden')
    expect(await db.select().from(orders)).toHaveLength(0)
  })

  it('refuses an unknown project', async () => {
    const { pm, product, env, auth } = await setup()
    const item = await seedCartItem(pm.id, product.id, env.id)

    const res = await checkout(auth, 999_999, [{ cartItemId: item.id }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Project not found')
  })

  it('rejects an empty item list before it reaches the service', async () => {
    // The service has its own 'The cart is empty' branch; the schema's min(1) means
    // a request can never get that far, so 400 comes from validation instead.
    const { project, auth } = await setup()
    const res = await POST(req({ projectId: project.id, items: [] }, auth))
    expect(res.status).toBe(400)
  })

  it('rejects the same cart item submitted twice', async () => {
    // Otherwise one item would become two orders — and two fired pipelines.
    const { pm, product, env, project, auth } = await setup()
    const item = await seedCartItem(pm.id, product.id, env.id)

    const res = await checkout(auth, project.id, [{ cartItemId: item.id }, { cartItemId: item.id }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('more than once')
    expect(await db.select().from(orders)).toHaveLength(0)
  })

  it('caps a checkout at MAX_CART_ITEMS — a cart is a way to fire pipelines', async () => {
    const { project, auth } = await setup()
    const items = Array.from({ length: MAX_CART_ITEMS + 1 }, (_, i) => ({
      cartItemId: i + 1,
      parameters: {},
    }))
    const res = await POST(req({ projectId: project.id, items }, auth))
    expect(res.status).toBe(400)
  })

  it('refuses an item whose product was deleted after it was added', async () => {
    // Deleting a product cascades the cart item away, so the checkout sees a cart
    // that no longer matches what the browser holds.
    const { pm, product, env, project, auth } = await setup()
    const item = await seedCartItem(pm.id, product.id, env.id)
    await db.delete(products).where(eq(products.id, product.id))

    const res = await checkout(auth, project.id, [{ cartItemId: item.id }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('The cart changed')
    expect(await db.select().from(orders)).toHaveLength(0)
  })

  it('refuses an item whose offering was withdrawn after it was added', async () => {
    // Validation happens at checkout time on purpose: the item was orderable when
    // it went into the cart, and is not any more.
    const { pm, product, env, project, auth } = await setup()
    const item = await seedCartItem(pm.id, product.id, env.id)
    await db
      .delete(productEnvironments)
      .where(
        and(
          eq(productEnvironments.productId, product.id),
          eq(productEnvironments.environmentId, env.id),
        ),
      )

    const res = await checkout(auth, project.id, [{ cartItemId: item.id }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('not offered')
    expect(await db.select().from(orders)).toHaveLength(0)
    // The item survives so the user can see why and remove it themselves.
    expect(await db.select().from(cartItems)).toHaveLength(1)
  })

  it('refuses when a forced cost centre is missing', async () => {
    const { pm, product, env, project, auth } = await setup()
    await db
      .update(productEnvironments)
      .set({ costCenterMode: 'select', forcedCostCenter: true })
      .where(
        and(
          eq(productEnvironments.productId, product.id),
          eq(productEnvironments.environmentId, env.id),
        ),
      )
    const item = await seedCartItem(pm.id, product.id, env.id)

    const res = await checkout(auth, project.id, [{ cartItemId: item.id }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('A cost center is required')
    expect(await db.select().from(orders)).toHaveLength(0)
  })

  it('refuses a deactivated cost centre — the foreign key only proves existence', async () => {
    const { pm, product, env, project, auth } = await setup()
    await db
      .update(productEnvironments)
      .set({ costCenterMode: 'select', forcedCostCenter: true })
      .where(
        and(
          eq(productEnvironments.productId, product.id),
          eq(productEnvironments.environmentId, env.id),
        ),
      )
    const retired = await createCostCenter({ active: false })
    const item = await seedCartItem(pm.id, product.id, env.id)

    const res = await checkout(auth, project.id, [{ cartItemId: item.id, costCenterId: retired.id }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('not active')
  })

  it('stores the chosen cost centre when the offering lets the user pick', async () => {
    const { pm, product, env, project, auth } = await setup()
    await db
      .update(productEnvironments)
      .set({ costCenterMode: 'select' })
      .where(
        and(
          eq(productEnvironments.productId, product.id),
          eq(productEnvironments.environmentId, env.id),
        ),
      )
    const cc = await createCostCenter()
    const item = await seedCartItem(pm.id, product.id, env.id)

    const res = await checkout(auth, project.id, [{ cartItemId: item.id, costCenterId: cc.id }])
    expect(res.status).toBe(201)
    const [order] = await db.select().from(orders)
    expect(order.costCenterId).toBe(cc.id)
  })

  it('carries a trial flag through to the order when the offering allows one', async () => {
    // A project manager's trial still waits for approval — the clock starts at
    // provisioning, so the flag is all that is recorded here.
    const { pm, product, env, project, auth } = await setup()
    await db
      .update(productEnvironments)
      .set({ trialEnabled: true, trialDurationMinutes: 30 })
      .where(
        and(
          eq(productEnvironments.productId, product.id),
          eq(productEnvironments.environmentId, env.id),
        ),
      )
    const item = await seedCartItem(pm.id, product.id, env.id)

    const res = await checkout(auth, project.id, [{ cartItemId: item.id, trial: true }])
    expect(res.status).toBe(201)
    const [order] = await db.select().from(orders)
    expect(order.isTrial).toBe(true)
    expect(order.status).toBe('pending')
  })

  it('refuses a trial of a product that was never opted in', async () => {
    // The browser hides the toggle for such a product, and a hidden control is
    // not a control.
    const { pm, product, env, project, auth } = await setup()
    const item = await seedCartItem(pm.id, product.id, env.id)

    const res = await checkout(auth, project.id, [{ cartItemId: item.id, trial: true }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('not available as a trial')
    expect(await db.select().from(orders)).toHaveLength(0)
  })

  it('creates nothing when one item of several fails validation', async () => {
    // The all-or-nothing gate is the only atomicity a checkout can offer: a fired
    // pipeline cannot be recalled, so nothing may be created until every item passes.
    const { pm, product, env, project, auth } = await setup()
    const good = await createProduct((await createCategory()).id, 'Good')
    await linkProductEnvironment(good.id, env.id, { price: '5.00' })
    await db.insert(parameters).values({
      scope: 'product', scopeId: product.id, name: 'SIZE', type: 'number', required: true,
    })
    const bad = await seedCartItem(pm.id, product.id, env.id)
    const fine = await seedCartItem(pm.id, good.id, env.id)

    const res = await checkout(auth, project.id, [{ cartItemId: fine.id }, { cartItemId: bad.id }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain(`#${bad.id}`)
    expect(await db.select().from(orders)).toHaveLength(0)
    // Both items survive, so the user fixes the named one and resubmits the cart.
    expect(await db.select().from(cartItems)).toHaveLength(2)
  })

  it('rejects a body that is not JSON at all', async () => {
    const { auth } = await setup()
    expect((await POST(brokenBodyReq(auth))).status).toBe(400)
  })

  it('rejects a missing body', async () => {
    const { auth } = await setup()
    expect((await POST(req(undefined, auth))).status).toBe(400)
  })

  it.each([
    {},
    { items: [{ cartItemId: 1, parameters: {} }] },
    { projectId: 'abc', items: [{ cartItemId: 1, parameters: {} }] },
    { projectId: 0, items: [{ cartItemId: 1, parameters: {} }] },
    { projectId: 1, items: [{ cartItemId: 0, parameters: {} }] },
    { projectId: 1, items: [{ cartItemId: 1 }] },
    { projectId: 1, items: [{ cartItemId: 1, parameters: { SIZE: 4 } }] },
    { projectId: 1, items: [{ cartItemId: 1, parameters: {}, costCenterId: 0 }] },
    { projectId: 1, items: [{ cartItemId: 1, parameters: {}, trial: 'yes' }] },
  ])('rejects a malformed checkout body (%j)', async (body) => {
    const { auth } = await setup()
    const res = await POST(req(body, auth))
    expect(res.status).toBe(400)
    expect(await db.select().from(orders)).toHaveLength(0)
  })

  it('orders every item in a multi-item cart into the one project', async () => {
    const { pm, product, env, project, auth } = await setup()
    const second = await createProduct((await createCategory()).id, 'Second')
    await linkProductEnvironment(second.id, env.id, { price: '5.00' })
    const a = await seedCartItem(pm.id, product.id, env.id)
    const b = await seedCartItem(pm.id, second.id, env.id)

    const res = await checkout(auth, project.id, [{ cartItemId: a.id }, { cartItemId: b.id }])
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.orderIds).toHaveLength(2)
    expect(body.failed).toEqual([])

    const created = await db.select().from(orders).where(eq(orders.projectId, project.id))
    expect(created).toHaveLength(2)
    expect(await db.select().from(cartItems)).toHaveLength(0)
  })

  it('persists the submitted parameters and the offering snapshot on each order', async () => {
    const { pm, product, env, project, auth } = await setup()
    await db.insert(parameters).values({
      scope: 'product', scopeId: product.id, name: 'HOSTNAME', type: 'string', required: true,
    })
    const item = await seedCartItem(pm.id, product.id, env.id)

    const res = await checkout(auth, project.id, [
      { cartItemId: item.id, parameters: { HOSTNAME: ' web-01 ' } },
    ])
    expect(res.status).toBe(201)

    const [order] = await db.select().from(orders)
    // Normalised on the way in, so no whitespace leaks into the CI variables.
    expect(order.parameters).toEqual({ HOSTNAME: 'web-01' })
    expect(order.productSnapshot).toMatchObject({ price: '10.00', currency: 'EUR' })
  })
})
