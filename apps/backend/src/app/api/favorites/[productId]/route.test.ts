import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT, DELETE } from './route'
import { db } from '@/lib/db/client'
import { productFavorites } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createUser, makeAuthHeader, createCategory, createProduct } from '@/test/helpers'

const req = (auth?: string, method = 'PUT') =>
  new NextRequest('http://localhost/api/favorites/1', {
    method,
    ...(auth ? { headers: { authorization: auth } } : {}),
  })

const p = (productId: string | number) => ({ params: Promise.resolve({ productId: String(productId) }) })

const setup = async () => {
  const pm = await createUser({ role: 'project_manager', email: 'fp-pm@test.dev' })
  const otherPm = await createUser({ role: 'project_manager', email: 'fp-other@test.dev' })
  const root = await createUser({ role: 'root', email: 'fp-root@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Nginx Gateway')
  const second = await createProduct(cat.id, 'Postgres')

  return {
    pm,
    otherPm,
    product,
    second,
    auth: await makeAuthHeader(pm),
    otherAuth: await makeAuthHeader(otherPm),
    rootAuth: await makeAuthHeader(root),
  }
}

const favoritesOf = (userId: number) =>
  db.select().from(productFavorites).where(eq(productFavorites.userId, userId))

describe('PUT /api/favorites/{productId}', () => {
  it('returns 401 without a token', async () => {
    const { product } = await setup()
    expect((await PUT(req(), p(product.id))).status).toBe(401)
  })

  it('stars the product for the calling user', async () => {
    const { pm, product, auth } = await setup()
    const res = await PUT(req(auth), p(product.id))
    expect(res.status).toBe(200)
    expect(await favoritesOf(pm.id)).toMatchObject([{ productId: product.id }])
  })

  it('never accepts a user id from the request — the session decides whose favourite it is', async () => {
    // There is no path here that could star something on another user's behalf:
    // the only user id in play comes out of the token.
    const { pm, otherPm, product, auth } = await setup()
    await PUT(req(auth), p(product.id))
    expect(await favoritesOf(pm.id)).toHaveLength(1)
    expect(await favoritesOf(otherPm.id)).toHaveLength(0)
  })

  it('is idempotent — a double-fired optimistic toggle must not surface as an error', async () => {
    const { pm, product, auth } = await setup()
    expect((await PUT(req(auth), p(product.id))).status).toBe(200)
    expect((await PUT(req(auth), p(product.id))).status).toBe(200)
    expect(await favoritesOf(pm.id)).toHaveLength(1)
  })

  it('is available to every role, root included', async () => {
    const { product, rootAuth } = await setup()
    expect((await PUT(req(rootAuth), p(product.id))).status).toBe(200)
  })

  it('returns 404 for a product that does not exist, rather than storing a dangling row', async () => {
    const { pm, auth } = await setup()
    expect((await PUT(req(auth), p(999_999))).status).toBe(404)
    expect(await favoritesOf(pm.id)).toHaveLength(0)
  })
})

describe('DELETE /api/favorites/{productId}', () => {
  it('returns 401 without a token', async () => {
    const { product } = await setup()
    expect((await DELETE(req(undefined, 'DELETE'), p(product.id))).status).toBe(401)
  })

  it('un-stars the caller\'s own favourite', async () => {
    const { pm, product, auth } = await setup()
    await PUT(req(auth), p(product.id))

    const res = await DELETE(req(auth, 'DELETE'), p(product.id))
    expect(res.status).toBe(200)
    expect(await favoritesOf(pm.id)).toHaveLength(0)
  })

  it('cannot un-star another user\'s favourite of the same product', async () => {
    // The delete is scoped by session user id as well as product id, so two users
    // starring the same product are independent of each other.
    const { pm, otherPm, product, auth, otherAuth } = await setup()
    await PUT(req(auth), p(product.id))
    await PUT(req(otherAuth), p(product.id))

    expect((await DELETE(req(auth, 'DELETE'), p(product.id))).status).toBe(200)
    expect(await favoritesOf(pm.id)).toHaveLength(0)
    expect(await favoritesOf(otherPm.id)).toHaveLength(1)
  })

  it('leaves the caller\'s other favourites alone', async () => {
    const { pm, product, second, auth } = await setup()
    await PUT(req(auth), p(product.id))
    await PUT(req(auth), p(second.id))

    await DELETE(req(auth, 'DELETE'), p(product.id))
    expect(await favoritesOf(pm.id)).toMatchObject([{ productId: second.id }])
  })

  it('is idempotent for a favourite that was never set', async () => {
    // Removing one that is already gone is the state the caller wanted. Note the
    // deliberate asymmetry with PUT, which 404s on an unknown product: the delete
    // has nothing to dangle, so it does not need the product to exist.
    const { auth } = await setup()
    expect((await DELETE(req(auth, 'DELETE'), p(999_999))).status).toBe(200)
  })
})

describe('favorite product id parsing', () => {
  it.each(['0', '-1', 'abc', '1.5', '', ' ', '5abc', 'NaN', 'Infinity', '1e400'])(
    'rejects a malformed product id (%j)',
    async (raw) => {
      const { auth } = await setup()
      expect((await PUT(req(auth), p(raw))).status).toBe(400)
      expect((await DELETE(req(auth, 'DELETE'), p(raw))).status).toBe(400)
    },
  )

  // Issue #143 made digits-only the contract for a route id: `parseRouteId` in
  // lib/http.ts refuses anything `/^\d+$/` does not match. Under the `Number()`
  // parse this route used before, every spelling below resolved to a real product
  // and starred it.
  it.each([
    ['hex', (id: number) => `0x${id.toString(16)}`],
    ['exponent', (id: number) => `${id}e0`],
    ['signed', (id: number) => `+${id}`],
    ['whitespace-padded', (id: number) => ` ${id} `],
  ])('refuses a %s spelling of a real product id (#143)', async (_label, spell) => {
    const { pm, product, auth } = await setup()

    expect((await PUT(req(auth), p(spell(product.id)))).status).toBe(400)
    expect(await favoritesOf(pm.id)).toHaveLength(0)

    expect((await DELETE(req(auth, 'DELETE'), p(spell(product.id)))).status).toBe(400)
  })
})
