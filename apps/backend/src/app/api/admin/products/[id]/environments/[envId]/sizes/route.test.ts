import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import {
  createUser, createCategory, createProduct, createCiSource, createEnvironment,
  linkProductEnvironment, createSize, makeAuthHeader,
} from '@/test/helpers'
import { db } from '@/lib/db/client'
import { productEnvironmentSizes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { SIZE_CODE_MAX_LENGTH } from '@/lib/services/sizes'

/**
 * The HTTP surface of the sizes collection (#181).
 *
 * `lib/services/admin/sizes.test.ts` covers what the service decides; this
 * covers what the route decides, which is a different list: the role, the path
 * ids, the Zod schema and the status codes. These two routes were the only 2 of
 * 88 that no route test imported — which is exactly how they came to be the only
 * two parsing their ids with `Number` instead of `parseRouteId`, accepting
 * `0x10` as 16 and reaching a real row with it (#143).
 */

const url = (productId: string, envId: string) =>
  `http://localhost/api/admin/products/${productId}/environments/${envId}/sizes`

const makeReq = (productId: string, envId: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(url(productId, envId), {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  })

const ctx = (id: string, envId: string) => ({ params: Promise.resolve({ id, envId }) })

async function offering() {
  const root = await createUser({ role: 'root' })
  const cat = await createCategory()
  const product = await createProduct(cat.id)
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  await linkProductEnvironment(product.id, env.id)
  return { root, product, env, auth: await makeAuthHeader(root) }
}

describe('GET /api/admin/products/[id]/environments/[envId]/sizes', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await GET(makeReq('1', '1'), ctx('1', '1'))).status).toBe(401)
  })

  // Root, not admin: a size is a price, and pricing is root's everywhere else in
  // this tree.
  it('refuses an admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    expect((await GET(makeReq('1', '1', 'GET', undefined, auth), ctx('1', '1'))).status).toBe(403)
  })

  it('lists the sizes of the offering, retired ones included', async () => {
    const { product, env, auth } = await offering()
    await createSize(product.id, env.id, { code: 'S', sortOrder: 0 })
    await createSize(product.id, env.id, { code: 'XL', sortOrder: 1, active: false })

    const res = await GET(makeReq(String(product.id), String(env.id), 'GET', undefined, auth), ctx(String(product.id), String(env.id)))

    expect(res.status).toBe(200)
    // Retired sizes stay readable, because existing orders reference them.
    expect((await res.json()).map((s: { code: string }) => s.code)).toEqual(['S', 'XL'])
  })

  it('answers 404 for an offering that does not exist', async () => {
    const { auth } = await offering()
    const res = await GET(makeReq('999999', '999999', 'GET', undefined, auth), ctx('999999', '999999'))
    expect(res.status).toBe(404)
  })

  /*
   * The reason this file exists. `Number('0x10')` is 16 and `Number(' 5 ')` is 5,
   * so a malformed segment used to resolve to a real row; `parseRouteId` is
   * digits-only. Both ids, because only checking the first is the same bug.
   */
  it.each([
    ['0x10', '1'],
    ['1', '0x10'],
    [' 5 ', '1'],
    ['abc', '1'],
    ['1', '-1'],
  ])('refuses the malformed path %s / %s with 400', async (id, envId) => {
    const { auth } = await offering()
    const res = await GET(makeReq(id, envId, 'GET', undefined, auth), ctx(id, envId))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/admin/products/[id]/environments/[envId]/sizes', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await POST(makeReq('1', '1', 'POST', { code: 'S' }), ctx('1', '1'))).status).toBe(401)
  })

  it('refuses an admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(makeReq('1', '1', 'POST', { code: 'S' }, auth), ctx('1', '1'))
    expect(res.status).toBe(403)
  })

  it('creates a size and answers 201', async () => {
    const { product, env, auth } = await offering()

    const res = await POST(
      makeReq(String(product.id), String(env.id), 'POST', { code: 'M', label: 'Medium', price: '20.00' }, auth),
      ctx(String(product.id), String(env.id)),
    )

    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ code: 'M', label: 'Medium', price: '20.00' })
    const rows = await db.select().from(productEnvironmentSizes).where(eq(productEnvironmentSizes.productId, product.id))
    expect(rows).toHaveLength(1)
  })

  // The code is the natural key an admin thinks in, so posting it twice corrects
  // that size rather than creating a second one with the same name.
  it('updates the existing size when the code is posted again', async () => {
    const { product, env, auth } = await offering()
    await POST(makeReq(String(product.id), String(env.id), 'POST', { code: 'M', price: '20.00' }, auth), ctx(String(product.id), String(env.id)))
    await POST(makeReq(String(product.id), String(env.id), 'POST', { code: 'M', price: '25.00' }, auth), ctx(String(product.id), String(env.id)))

    const rows = await db.select().from(productEnvironmentSizes).where(eq(productEnvironmentSizes.productId, product.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].price).toBe('25.00')
  })

  it('answers 404 for an offering that does not exist', async () => {
    const { auth } = await offering()
    const res = await POST(makeReq('999999', '999999', 'POST', { code: 'M' }, auth), ctx('999999', '999999'))
    expect(res.status).toBe(404)
  })

  it.each([
    ['no code at all', {}],
    ['an empty code', { code: '' }],
    ['a code past the length the column allows', { code: 'x'.repeat(SIZE_CODE_MAX_LENGTH + 1) }],
    ['a currency that is not three letters', { code: 'M', currency: 'EURO' }],
    ['a negative sort order', { code: 'M', sortOrder: -1 }],
    ['a non-boolean active flag', { code: 'M', active: 'yes' }],
  ])('rejects %s with 400', async (_name, body) => {
    const { product, env, auth } = await offering()
    const res = await POST(makeReq(String(product.id), String(env.id), 'POST', body, auth), ctx(String(product.id), String(env.id)))
    expect(res.status).toBe(400)
  })

  it('rejects a body that is not JSON at all', async () => {
    const { product, env, auth } = await offering()
    const res = await POST(
      new NextRequest(url(String(product.id), String(env.id)), {
        method: 'POST',
        body: 'not json',
        headers: { 'content-type': 'application/json', authorization: auth },
      }),
      ctx(String(product.id), String(env.id)),
    )
    expect(res.status).toBe(400)
  })

  it('refuses a malformed path id with 400', async () => {
    const { auth } = await offering()
    const res = await POST(makeReq('0x10', '1', 'POST', { code: 'M' }, auth), ctx('0x10', '1'))
    expect(res.status).toBe(400)
  })
})
