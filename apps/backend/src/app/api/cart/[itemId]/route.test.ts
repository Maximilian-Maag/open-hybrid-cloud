import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT, DELETE } from './route'
import { db } from '@/lib/db/client'
import { cartItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  makeAuthHeader,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  linkProductEnvironment,
} from '@/test/helpers'

const req = (body?: unknown, auth?: string, method = 'PUT') =>
  new NextRequest('http://localhost/api/cart/1', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(auth ? { headers: { authorization: auth, 'content-type': 'application/json' } } : {}),
  })

/** A raw request whose body is not JSON at all. */
const brokenBodyReq = (auth: string) =>
  new NextRequest('http://localhost/api/cart/1', {
    method: 'PUT',
    body: '{',
    headers: { authorization: auth, 'content-type': 'application/json' },
  })

const p = (itemId: string | number) => ({ params: Promise.resolve({ itemId: String(itemId) }) })

const seedCartItem = async (
  userId: number,
  productId: number,
  environmentId: number,
  params: Record<string, string> = {},
) => {
  const [item] = await db
    .insert(cartItems)
    .values({ userId, productId, environmentId, parameters: params })
    .returning()
  return item
}

const setup = async () => {
  const pm = await createUser({ role: 'project_manager', email: 'ci-pm@test.dev' })
  const otherPm = await createUser({ role: 'project_manager', email: 'ci-other@test.dev' })
  const admin = await createUser({ role: 'admin', email: 'ci-admin@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Nginx Gateway')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  await linkProductEnvironment(product.id, env.id, { price: '10.00' })

  return {
    pm,
    otherPm,
    product,
    env,
    auth: await makeAuthHeader(pm),
    otherAuth: await makeAuthHeader(otherPm),
    adminAuth: await makeAuthHeader(admin),
  }
}

describe('PUT /api/cart/{itemId}', () => {
  it('returns 401 without a token', async () => {
    await setup()
    expect((await PUT(req({ parameters: {} }), p(1))).status).toBe(401)
  })

  it('saves the checkout form\'s progress on the caller\'s own item', async () => {
    const { pm, product, env, auth } = await setup()
    const item = await seedCartItem(pm.id, product.id, env.id)

    const res = await PUT(req({ parameters: { HOSTNAME: 'web-01' } }, auth), p(item.id))
    expect(res.status).toBe(200)

    const [stored] = await db.select().from(cartItems).where(eq(cartItems.id, item.id))
    expect(stored.parameters).toEqual({ HOSTNAME: 'web-01' })
  })

  it('is open to a project manager — a cart is not an admin feature', async () => {
    const { pm, product, env, auth } = await setup()
    const item = await seedCartItem(pm.id, product.id, env.id)
    expect((await PUT(req({ parameters: {} }, auth), p(item.id))).status).toBe(200)
  })

  it('stores parameters unvalidated — a cart is a shopping list', async () => {
    // Refusing to hold an incomplete item would defeat the point of collecting
    // first and filling in at checkout, where validation actually happens.
    const { pm, product, env, auth } = await setup()
    const item = await seedCartItem(pm.id, product.id, env.id)

    const res = await PUT(req({ parameters: { SIZE: 'not-a-number' } }, auth), p(item.id))
    expect(res.status).toBe(200)
    const [stored] = await db.select().from(cartItems).where(eq(cartItems.id, item.id))
    expect(stored.parameters).toEqual({ SIZE: 'not-a-number' })
  })

  it('replaces the stored parameters rather than merging into them', async () => {
    const { pm, product, env, auth } = await setup()
    const item = await seedCartItem(pm.id, product.id, env.id, { A: '1', B: '2' })

    await PUT(req({ parameters: { A: '9' } }, auth), p(item.id))
    const [stored] = await db.select().from(cartItems).where(eq(cartItems.id, item.id))
    expect(stored.parameters).toEqual({ A: '9' })
  })

  it('cannot touch another user\'s cart item', async () => {
    // Scoped by session user id, so a guessable item id from someone else's cart
    // is a 404 and their stored values are untouched.
    const { otherPm, product, env, auth } = await setup()
    const theirs = await seedCartItem(otherPm.id, product.id, env.id, { SECRET: 'theirs' })

    const res = await PUT(req({ parameters: { SECRET: 'mine' } }, auth), p(theirs.id))
    expect(res.status).toBe(404)

    const [stored] = await db.select().from(cartItems).where(eq(cartItems.id, theirs.id))
    expect(stored.parameters).toEqual({ SECRET: 'theirs' })
  })

  it('does not let an admin reach a project manager\'s cart either', async () => {
    // A cart is personal; there is no admin override on it.
    const { pm, product, env, adminAuth } = await setup()
    const theirs = await seedCartItem(pm.id, product.id, env.id)
    expect((await PUT(req({ parameters: {} }, adminAuth), p(theirs.id))).status).toBe(404)
  })

  it('returns 404 for an item that does not exist', async () => {
    const { auth } = await setup()
    expect((await PUT(req({ parameters: {} }, auth), p(999_999))).status).toBe(404)
  })

  it('rejects a missing body', async () => {
    const { pm, product, env, auth } = await setup()
    const item = await seedCartItem(pm.id, product.id, env.id)
    expect((await PUT(req(undefined, auth), p(item.id))).status).toBe(400)
  })

  it('rejects a body that is not JSON at all', async () => {
    const { auth } = await setup()
    expect((await PUT(brokenBodyReq(auth), p(1))).status).toBe(400)
  })

  it.each([{}, { parameters: null }, { parameters: [] }, { parameters: { SIZE: 4 } }, { parameters: 'x' }])(
    'rejects a body that fails validation (%j)',
    async (body) => {
      const { pm, product, env, auth } = await setup()
      const item = await seedCartItem(pm.id, product.id, env.id, { KEEP: 'me' })

      expect((await PUT(req(body, auth), p(item.id))).status).toBe(400)
      const [stored] = await db.select().from(cartItems).where(eq(cartItems.id, item.id))
      expect(stored.parameters).toEqual({ KEEP: 'me' })
    },
  )
})

describe('DELETE /api/cart/{itemId}', () => {
  it('returns 401 without a token', async () => {
    await setup()
    expect((await DELETE(req(undefined, undefined, 'DELETE'), p(1))).status).toBe(401)
  })

  it('removes the caller\'s own item', async () => {
    const { pm, product, env, auth } = await setup()
    const item = await seedCartItem(pm.id, product.id, env.id)

    const res = await DELETE(req(undefined, auth, 'DELETE'), p(item.id))
    expect(res.status).toBe(200)
    expect(await db.select().from(cartItems).where(eq(cartItems.id, item.id))).toHaveLength(0)
  })

  it('leaves another user\'s item in place while still reporting success', async () => {
    // Removal is idempotent by design, so this is a 200 — but the scope means the
    // other user's item is not what got deleted, which is the assertion that counts.
    const { otherPm, product, env, auth } = await setup()
    const theirs = await seedCartItem(otherPm.id, product.id, env.id)

    const res = await DELETE(req(undefined, auth, 'DELETE'), p(theirs.id))
    expect(res.status).toBe(200)
    expect(await db.select().from(cartItems).where(eq(cartItems.id, theirs.id))).toHaveLength(1)
  })

  it('is idempotent for an item that is already gone', async () => {
    // Removing what is already gone is the state the caller wanted.
    const { auth } = await setup()
    expect((await DELETE(req(undefined, auth, 'DELETE'), p(999_999))).status).toBe(200)
  })

  it('deletes only the named item, not the rest of the cart', async () => {
    const { pm, product, env, auth } = await setup()
    const first = await seedCartItem(pm.id, product.id, env.id)
    const second = await seedCartItem(pm.id, product.id, env.id)

    await DELETE(req(undefined, auth, 'DELETE'), p(first.id))
    const left = await db.select().from(cartItems).where(eq(cartItems.userId, pm.id))
    expect(left.map((row) => row.id)).toEqual([second.id])
  })
})

describe('cart item id parsing', () => {
  it.each(['0', '-1', 'abc', '1.5', '', ' ', '5abc', 'NaN', 'Infinity', '1e400'])(
    'rejects a malformed item id (%j)',
    async (raw) => {
      const { auth } = await setup()
      expect((await PUT(req({ parameters: {} }, auth), p(raw))).status).toBe(400)
      expect((await DELETE(req(undefined, auth, 'DELETE'), p(raw))).status).toBe(400)
    },
  )

  // Issue #143: this route parses its id with `Number()` + `Number.isInteger`
  // rather than `parseRouteId` from lib/http.ts, which is digits-only. `Number`
  // accepts hex, exponent, signed and whitespace-padded spellings, so several
  // strings that are not a decimal id still resolve to a real row. Asserting the
  // CURRENT behaviour — this is a documented deviation, not the intended contract.
  it.each([
    ['hex', (id: number) => `0x${id.toString(16)}`],
    ['exponent', (id: number) => `${id}e0`],
    ['signed', (id: number) => `+${id}`],
    ['whitespace-padded', (id: number) => ` ${id} `],
    ['trailing-zero decimal', (id: number) => `${id}.0`],
  ])('accepts a %s spelling of a real id (#143)', async (_label, spell) => {
    const { pm, product, env, auth } = await setup()
    const item = await seedCartItem(pm.id, product.id, env.id)

    const res = await PUT(req({ parameters: { REACHED: 'yes' } }, auth), p(spell(item.id)))
    expect(res.status).toBe(200)
    const [stored] = await db.select().from(cartItems).where(eq(cartItems.id, item.id))
    expect(stored.parameters).toEqual({ REACHED: 'yes' })
  })
})
