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
import { GET, POST, DELETE } from './route'
import { PUT as PUT_ITEM, DELETE as DELETE_ITEM } from './[itemId]/route'
import { POST as CHECKOUT } from './checkout/route'
import { db } from '@/lib/db/client'
import { cartItems, orders, parameters } from '@/lib/db/schema'
import {
  createUser,
  makeAuthHeader,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  linkProductEnvironment,
} from '@/test/helpers'

const req = (body?: unknown, auth?: string, method = 'POST') =>
  new NextRequest('http://localhost/api/cart', {
    method: body === undefined ? 'GET' : method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(auth ? { headers: { authorization: auth, 'content-type': 'application/json' } } : {}),
  })

const itemParams = (itemId: string | number) => ({ params: Promise.resolve({ itemId: String(itemId) }) })

const setup = async () => {
  const pm = await createUser({ role: 'project_manager', email: 'cr-cart-pm@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'P')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  await linkProductEnvironment(product.id, env.id, { price: '10.00' })
  const project = await createProject(pm.id)
  return { pm, product, env, project, auth: await makeAuthHeader(pm) }
}

describe('cart API', () => {
  it('requires authentication on every verb', async () => {
    await setup()
    expect((await GET(req())).status).toBe(401)
    expect((await POST(req({ productId: 1, environmentId: 1 }))).status).toBe(401)
    expect((await DELETE(req(undefined, undefined, 'DELETE'))).status).toBe(401)
    expect((await PUT_ITEM(req({ parameters: {} }, undefined, 'PUT'), itemParams(1))).status).toBe(401)
    expect((await DELETE_ITEM(req(undefined), itemParams(1))).status).toBe(401)
    expect((await CHECKOUT(req({ projectId: 1, items: [] }))).status).toBe(401)
  })

  it('round-trips add, list, update, remove and clear', async () => {
    const { product, env, auth } = await setup()

    const added = await POST(req({ productId: product.id, environmentId: env.id }, auth))
    expect(added.status).toBe(201)
    const item = await added.json()

    const listed = await GET(req(undefined, auth))
    expect(await listed.json()).toMatchObject([{ id: item.id, productName: 'P' }])

    const updated = await PUT_ITEM(req({ parameters: { H: 'x' } }, auth, 'PUT'), itemParams(item.id))
    expect(updated.status).toBe(200)

    expect((await DELETE_ITEM(req(undefined, auth), itemParams(item.id))).status).toBe(200)
    expect(await (await GET(req(undefined, auth))).json()).toEqual([])

    await POST(req({ productId: product.id, environmentId: env.id }, auth))
    expect((await DELETE(req({}, auth, 'DELETE'))).status).toBe(200)
    expect(await (await GET(req(undefined, auth))).json()).toEqual([])
  })

  it.each([{}, { productId: 1 }, { productId: 0, environmentId: 1 }, { productId: 'a', environmentId: 1 }])(
    'rejects a malformed add body (%j)',
    async (body) => {
      const { auth } = await setup()
      expect((await POST(req(body, auth))).status).toBe(400)
    },
  )

  it('returns 400 for a product that is not offered', async () => {
    const { product, auth } = await setup()
    const ci = await createCiSource()
    const other = await createEnvironment(ci.id)
    const res = await POST(req({ productId: product.id, environmentId: other.id }, auth))
    expect(res.status).toBe(400)
  })

  it.each(['0', 'abc'])('rejects a malformed item id (%s)', async (raw) => {
    const { auth } = await setup()
    expect((await PUT_ITEM(req({ parameters: {} }, auth, 'PUT'), itemParams(raw))).status).toBe(400)
    expect((await DELETE_ITEM(req(undefined, auth), itemParams(raw))).status).toBe(400)
  })

  it('returns 404 when updating an item that is not the caller\'s', async () => {
    const { auth } = await setup()
    expect((await PUT_ITEM(req({ parameters: {} }, auth, 'PUT'), itemParams(999_999))).status).toBe(404)
  })

  it('checks out the cart into orders', async () => {
    const { product, env, project, auth } = await setup()
    const added = await (await POST(req({ productId: product.id, environmentId: env.id }, auth))).json()

    const res = await CHECKOUT(
      req({ projectId: project.id, items: [{ cartItemId: added.id, parameters: {} }] }, auth),
    )
    expect(res.status).toBe(201)
    expect((await res.json()).orderIds).toHaveLength(1)
    expect(await db.select().from(orders)).toHaveLength(1)
    expect(await db.select().from(cartItems)).toHaveLength(0)
  })

  it('creates nothing when one item fails validation', async () => {
    const { product, env, project, auth } = await setup()
    await db.insert(parameters).values({
      scope: 'product', scopeId: product.id, name: 'SIZE', type: 'number', required: true,
    })
    const added = await (await POST(req({ productId: product.id, environmentId: env.id }, auth))).json()

    const res = await CHECKOUT(
      req({ projectId: project.id, items: [{ cartItemId: added.id, parameters: {} }] }, auth),
    )
    expect(res.status).toBe(400)
    expect(await db.select().from(orders)).toHaveLength(0)
    // The cart survives so the user can fix and resubmit.
    expect(await db.select().from(cartItems)).toHaveLength(1)
  })

  it.each([
    { projectId: 1 },
    { projectId: 1, items: [] },
    { projectId: 0, items: [{ cartItemId: 1, parameters: {} }] },
    { projectId: 1, items: [{ cartItemId: 1 }] },
  ])('rejects a malformed checkout body (%j)', async (body) => {
    const { auth } = await setup()
    expect((await CHECKOUT(req(body, auth))).status).toBe(400)
  })
})
