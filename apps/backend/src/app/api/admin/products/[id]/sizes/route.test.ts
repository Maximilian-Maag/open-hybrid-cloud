import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import {
  createUser, createCategory, createProduct, createCiSource, createEnvironment,
  linkProductEnvironment, createSize, makeAuthHeader,
} from '@/test/helpers'

/**
 * The HTTP surface of the size matrix (#249).
 *
 * `lib/services/admin/sizes.test.ts` covers what the grid means; this covers what
 * the route decides — the role, the id parsing and the status codes.
 */

const makeReq = (productId: string, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${productId}/sizes`, {
    headers: { ...(auth ? { authorization: auth } : {}) },
  })

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function product() {
  const root = await createUser({ role: 'root' })
  const cat = await createCategory()
  const p = await createProduct(cat.id)
  const ci = await createCiSource()
  const frankfurt = await createEnvironment(ci.id, undefined, 'Frankfurt')
  const vienna = await createEnvironment(ci.id, undefined, 'Vienna')
  await linkProductEnvironment(p.id, frankfurt.id)
  await linkProductEnvironment(p.id, vienna.id)
  return { root, p, frankfurt, vienna, auth: await makeAuthHeader(root) }
}

describe('GET /api/admin/products/[id]/sizes', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await GET(makeReq('1'), ctx('1'))).status).toBe(401)
  })

  // Root, not admin: a size is a price, and pricing is root's everywhere in this
  // tree — the per-offering endpoint one level down draws the same line.
  it('refuses an admin', async () => {
    const auth = await makeAuthHeader(await createUser({ role: 'admin' }))
    expect((await GET(makeReq('1', auth), ctx('1'))).status).toBe(403)
  })

  it('answers with one row per code and one column per offering', async () => {
    const { p, frankfurt, vienna, auth } = await product()
    await createSize(p.id, frankfurt.id, { code: 'XL', price: '40.00' })
    await createSize(p.id, vienna.id, { code: 'XL', price: '100.00' })

    const res = await GET(makeReq(String(p.id), auth), ctx(String(p.id)))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.environments.map((e: { name: string }) => e.name)).toEqual(['Frankfurt', 'Vienna'])
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0].cells.map((c: { price: string }) => c.price).sort()).toEqual(['100.00', '40.00'])
  })

  it('answers 404 for a product that does not exist', async () => {
    const { auth } = await product()
    expect((await GET(makeReq('999999', auth), ctx('999999'))).status).toBe(404)
  })

  // `Number('0x10')` is 16 and `Number(' 5 ')` is 5, so a malformed segment used
  // to resolve to a real row (#143). parseRouteId is digits-only.
  it.each(['0x10', ' 5 ', 'abc', '-1'])('refuses the malformed id %s with 400', async (id) => {
    const { auth } = await product()
    expect((await GET(makeReq(id, auth), ctx(id))).status).toBe(400)
  })
})
