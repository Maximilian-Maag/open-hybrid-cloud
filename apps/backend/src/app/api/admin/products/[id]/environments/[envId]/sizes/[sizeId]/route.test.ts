import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE } from './route'
import {
  createUser, createCategory, createProduct, createCiSource, createEnvironment,
  linkProductEnvironment, createSize, makeAuthHeader,
} from '@/test/helpers'
import { db } from '@/lib/db/client'
import { productEnvironmentSizes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * The HTTP surface of one size (#181).
 *
 * Deletion goes by id while creation and update go by code, and that asymmetry
 * is deliberate: the code is what an admin edits by, but deleting by a name that
 * has just been renamed removes the wrong row.
 */

const makeReq = (productId: string, envId: string, sizeId: string, auth?: string) =>
  new NextRequest(
    `http://localhost/api/admin/products/${productId}/environments/${envId}/sizes/${sizeId}`,
    { method: 'DELETE', headers: { ...(auth ? { authorization: auth } : {}) } },
  )

const ctx = (id: string, envId: string, sizeId: string) => ({
  params: Promise.resolve({ id, envId, sizeId }),
})

async function withSize() {
  const root = await createUser({ role: 'root' })
  const cat = await createCategory()
  const product = await createProduct(cat.id)
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  await linkProductEnvironment(product.id, env.id)
  const size = await createSize(product.id, env.id, { code: 'M' })
  return { product, env, size, auth: await makeAuthHeader(root) }
}

describe('DELETE /api/admin/products/[id]/environments/[envId]/sizes/[sizeId]', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await DELETE(makeReq('1', '1', '1'), ctx('1', '1', '1'))).status).toBe(401)
  })

  it('refuses an admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    expect((await DELETE(makeReq('1', '1', '1', auth), ctx('1', '1', '1'))).status).toBe(403)
  })

  it('removes the size', async () => {
    const { product, env, size, auth } = await withSize()

    const res = await DELETE(
      makeReq(String(product.id), String(env.id), String(size.id), auth),
      ctx(String(product.id), String(env.id), String(size.id)),
    )

    expect(res.status).toBe(200)
    expect(await db.select().from(productEnvironmentSizes).where(eq(productEnvironmentSizes.id, size.id))).toEqual([])
  })

  it('answers 404 for a size that is not there', async () => {
    const { product, env, auth } = await withSize()
    const res = await DELETE(
      makeReq(String(product.id), String(env.id), '999999', auth),
      ctx(String(product.id), String(env.id), '999999'),
    )
    expect(res.status).toBe(404)
  })

  /*
   * The id triple has to agree. A size belongs to one offering, so naming
   * somebody else's product or environment must not delete it — the WHERE
   * carries all three for exactly this reason.
   */
  it('will not delete a size through another offering', async () => {
    const { size, auth } = await withSize()
    const other = await withSize()

    const res = await DELETE(
      makeReq(String(other.product.id), String(other.env.id), String(size.id), auth),
      ctx(String(other.product.id), String(other.env.id), String(size.id)),
    )

    expect(res.status).toBe(404)
    expect(await db.select().from(productEnvironmentSizes).where(eq(productEnvironmentSizes.id, size.id))).toHaveLength(1)
  })

  // `Number('0x10')` is 16 and `Number(' 5 ')` is 5, so a malformed segment used
  // to resolve to a real size (#143). All three ids, because checking two of
  // them is the same bug in a smaller place.
  it.each([
    ['0x10', '1', '1'],
    ['1', '0x10', '1'],
    ['1', '1', '0x10'],
    ['1', '1', ' 5 '],
    ['1', '1', 'abc'],
  ])('refuses the malformed path %s / %s / %s with 400', async (id, envId, sizeId) => {
    const { auth } = await withSize()
    const res = await DELETE(makeReq(id, envId, sizeId, auth), ctx(id, envId, sizeId))
    expect(res.status).toBe(400)
  })
})
