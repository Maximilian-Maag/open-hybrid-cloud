import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { GET as DIFF } from './diff/route'
import { recordProductVersion, listProductVersions } from '@/lib/services/versions'
import { db } from '@/lib/db/client'
import { productEnvironments } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  createUser,
  makeAuthHeader,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  linkProductEnvironment,
} from '@/test/helpers'

const req = (url: string, auth?: string) =>
  new NextRequest(url, auth ? { headers: { authorization: auth } } : undefined)

const p = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) })

const setup = async () => {
  const root = await createUser({ role: 'root', email: 'vr-root@test.dev', name: 'Root' })
  const admin = await createUser({ role: 'admin', email: 'vr-admin@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'P')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  await linkProductEnvironment(product.id, env.id, { price: '10.00' })
  return {
    product,
    env,
    root,
    rootAuth: await makeAuthHeader(root),
    adminAuth: await makeAuthHeader(admin),
  }
}

const twoVersions = async () => {
  const ctx = await setup()
  await recordProductVersion({ productId: ctx.product.id, environmentId: ctx.env.id, summary: 'v1', userId: ctx.root.id })
  await db
    .update(productEnvironments)
    .set({ price: '20.00' })
    .where(and(eq(productEnvironments.productId, ctx.product.id), eq(productEnvironments.environmentId, ctx.env.id)))
  await recordProductVersion({ productId: ctx.product.id, environmentId: ctx.env.id, summary: 'v2', userId: ctx.root.id })

  const listed = await listProductVersions(ctx.product.id)
  if (!listed.ok) throw new Error('setup failed')
  return { ...ctx, newer: listed.data[0], older: listed.data[1] }
}

describe('GET /api/admin/products/{id}/versions', () => {
  it('returns 401 without a token', async () => {
    const { product } = await setup()
    expect((await GET(req(`http://localhost/v`), p(product.id))).status).toBe(401)
  })

  it('returns 403 for an admin — the catalogue is root-only', async () => {
    const { product, adminAuth } = await setup()
    expect((await GET(req('http://localhost/v', adminAuth), p(product.id))).status).toBe(403)
  })

  it('returns the history for root', async () => {
    const { product, rootAuth, newer } = await twoVersions()
    const res = await GET(req('http://localhost/v', rootAuth), p(product.id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body[0]).toMatchObject({ id: newer.id, summary: 'v2', authorName: 'Root' })
  })

  it.each(['0', 'abc'])('rejects a malformed product id (%s)', async (raw) => {
    const { rootAuth } = await setup()
    expect((await GET(req('http://localhost/v', rootAuth), p(raw))).status).toBe(400)
  })

  it('returns 404 for an unknown product', async () => {
    const { rootAuth } = await setup()
    expect((await GET(req('http://localhost/v', rootAuth), p(999_999))).status).toBe(404)
  })
})

describe('GET /api/admin/products/{id}/versions/diff', () => {
  it('returns 401 without a token and 403 for an admin', async () => {
    const { product, adminAuth, older, newer } = await twoVersions()
    const url = `http://localhost/d?from=${older.id}&to=${newer.id}`
    expect((await DIFF(req(url), p(product.id))).status).toBe(401)
    expect((await DIFF(req(url, adminAuth), p(product.id))).status).toBe(403)
  })

  it('diffs two versions', async () => {
    const { product, rootAuth, older, newer } = await twoVersions()
    const res = await DIFF(req(`http://localhost/d?from=${older.id}&to=${newer.id}`, rootAuth), p(product.id))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      fields: [{ field: 'price', from: '10.00', to: '20.00' }],
      identical: false,
    })
  })

  it.each(['', '?from=1', '?to=1', '?from=abc&to=1', '?from=0&to=1'])(
    'rejects missing or malformed version ids (%s)',
    async (query) => {
      const { product, rootAuth } = await twoVersions()
      const res = await DIFF(req(`http://localhost/d${query}`, rootAuth), p(product.id))
      expect(res.status).toBe(400)
    },
  )

  it('returns 404 when a version does not belong to this product', async () => {
    const { rootAuth, older, newer } = await twoVersions()
    const other = await createProduct((await createCategory()).id, 'Other')
    const res = await DIFF(
      req(`http://localhost/d?from=${older.id}&to=${newer.id}`, rootAuth),
      p(other.id),
    )
    expect(res.status).toBe(404)
  })
})
