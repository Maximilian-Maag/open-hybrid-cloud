import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT, DELETE } from './route'
import {
  createUser, createCategory, createProduct, createCiSource, createEnvironment,
  linkProductEnvironment, createSize, makeAuthHeader,
} from '@/test/helpers'
import { db } from '@/lib/db/client'
import { productEnvironmentSizes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { SIZE_CODE_MAX_LENGTH } from '@/lib/services/sizes'

/**
 * The HTTP surface of one matrix row (#249). The service decides what a row save
 * means; this decides the role, the two path segments and the Zod schema.
 */

const url = (productId: string, code: string) =>
  `http://localhost/api/admin/products/${productId}/sizes/${code}`

const makeReq = (productId: string, code: string, method: string, body?: unknown, auth?: string) =>
  new NextRequest(url(productId, code), {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  })

const ctx = (id: string, code: string) => ({ params: Promise.resolve({ id, code }) })

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

describe('PUT /api/admin/products/[id]/sizes/[code]', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await PUT(makeReq('1', 'XL', 'PUT', { cells: [] }), ctx('1', 'XL'))).status).toBe(401)
  })

  it('refuses an admin', async () => {
    const auth = await makeAuthHeader(await createUser({ role: 'admin' }))
    const res = await PUT(makeReq('1', 'XL', 'PUT', { cells: [] }, auth), ctx('1', 'XL'))
    expect(res.status).toBe(403)
  })

  it('prices the size in every environment named and answers with the row', async () => {
    const { p, frankfurt, vienna, auth } = await product()

    const res = await PUT(
      makeReq(String(p.id), 'XL', 'PUT', {
        label: 'Extra large',
        cells: [
          { environmentId: frankfurt.id, price: '40.00', currency: 'EUR' },
          { environmentId: vienna.id, price: '100.00', currency: 'CHF' },
        ],
      }, auth),
      ctx(String(p.id), 'XL'),
    )

    expect(res.status).toBe(200)
    expect((await res.json()).cells).toHaveLength(2)
    expect(await db.select().from(productEnvironmentSizes).where(eq(productEnvironmentSizes.productId, p.id))).toHaveLength(2)
  })

  it('retires the environments the body leaves out', async () => {
    const { p, frankfurt, vienna, auth } = await product()
    await createSize(p.id, frankfurt.id, { code: 'XL', price: '40.00' })
    await createSize(p.id, vienna.id, { code: 'XL', price: '100.00' })

    await PUT(
      makeReq(String(p.id), 'XL', 'PUT', { cells: [{ environmentId: frankfurt.id, price: '40.00' }] }, auth),
      ctx(String(p.id), 'XL'),
    )

    const rows = await db.select().from(productEnvironmentSizes).where(eq(productEnvironmentSizes.productId, p.id))
    // Retired, not deleted: orders reference the code and their history has to
    // keep rendering.
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.environmentId === vienna.id)?.active).toBe(false)
  })

  it('answers 404 for a product that does not exist', async () => {
    const { auth } = await product()
    const res = await PUT(makeReq('999999', 'XL', 'PUT', { cells: [] }, auth), ctx('999999', 'XL'))
    expect(res.status).toBe(404)
  })

  it.each([
    ['no cells array at all', {}],
    ['a cell without an environment', { cells: [{ price: '1.00' }] }],
    ['a cell whose environment id is not a number', { cells: [{ environmentId: 'one', price: '1.00' }] }],
    ['a currency that is not three letters', { cells: [{ environmentId: 1, currency: 'EURO' }] }],
    ['a negative sort order', { cells: [], sortOrder: -1 }],
  ])('rejects %s with 400', async (_name, body) => {
    const { p, auth } = await product()
    const res = await PUT(makeReq(String(p.id), 'XL', 'PUT', body, auth), ctx(String(p.id), 'XL'))
    expect(res.status).toBe(400)
  })

  it('rejects a body that is not JSON at all', async () => {
    const { p, auth } = await product()
    const res = await PUT(
      new NextRequest(url(String(p.id), 'XL'), {
        method: 'PUT',
        body: 'not json',
        headers: { 'content-type': 'application/json', authorization: auth },
      }),
      ctx(String(p.id), 'XL'),
    )
    expect(res.status).toBe(400)
  })

  /*
   * The code is the one segment here that is deliberately NOT a row id — the same
   * size has a different id in every environment — so it gets its own bounds
   * instead of parseRouteId's.
   */
  it.each([
    ['empty', ''],
    ['whitespace only', '%20%20'],
    ['longer than the column allows', 'x'.repeat(SIZE_CODE_MAX_LENGTH + 1)],
  ])('refuses a code that is %s with 400', async (_name, code) => {
    const { p, auth } = await product()
    const res = await PUT(makeReq(String(p.id), code, 'PUT', { cells: [] }, auth), ctx(String(p.id), code))
    expect(res.status).toBe(400)
  })

  it('refuses a malformed product id with 400', async () => {
    const { auth } = await product()
    expect((await PUT(makeReq('0x10', 'XL', 'PUT', { cells: [] }, auth), ctx('0x10', 'XL'))).status).toBe(400)
  })
})

describe('DELETE /api/admin/products/[id]/sizes/[code]', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await DELETE(makeReq('1', 'XL', 'DELETE'), ctx('1', 'XL'))).status).toBe(401)
  })

  it('refuses an admin', async () => {
    const auth = await makeAuthHeader(await createUser({ role: 'admin' }))
    expect((await DELETE(makeReq('1', 'XL', 'DELETE', undefined, auth), ctx('1', 'XL'))).status).toBe(403)
  })

  it('removes the code from every environment', async () => {
    const { p, frankfurt, vienna, auth } = await product()
    await createSize(p.id, frankfurt.id, { code: 'XL' })
    await createSize(p.id, vienna.id, { code: 'XL' })
    await createSize(p.id, frankfurt.id, { code: 'S' })

    const res = await DELETE(makeReq(String(p.id), 'XL', 'DELETE', undefined, auth), ctx(String(p.id), 'XL'))

    expect(res.status).toBe(200)
    const rows = await db.select().from(productEnvironmentSizes).where(eq(productEnvironmentSizes.productId, p.id))
    expect(rows.map((r) => r.code)).toEqual(['S'])
  })

  it('answers 404 for a code no environment has', async () => {
    const { p, auth } = await product()
    const res = await DELETE(makeReq(String(p.id), 'XXL', 'DELETE', undefined, auth), ctx(String(p.id), 'XXL'))
    expect(res.status).toBe(404)
  })

  it('refuses a malformed product id with 400', async () => {
    const { auth } = await product()
    expect((await DELETE(makeReq('abc', 'XL', 'DELETE', undefined, auth), ctx('abc', 'XL'))).status).toBe(400)
  })
})
