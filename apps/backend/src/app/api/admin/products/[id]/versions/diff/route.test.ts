import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { db } from '@/lib/db/client'
import { parameters, productEnvironments } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { recordProductVersion, listProductVersions } from '@/lib/services/versions'
import {
  createUser,
  makeAuthHeader,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createCostCenter,
  linkProductEnvironment,
} from '@/test/helpers'

const req = (query = '', auth?: string) =>
  new NextRequest(
    `http://localhost/api/admin/products/1/versions/diff${query}`,
    auth ? { headers: { authorization: auth } } : undefined,
  )

const p = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) })

const setup = async () => {
  const root = await createUser({ role: 'root', email: 'vd-root@test.dev', name: 'Root' })
  const admin = await createUser({ role: 'admin', email: 'vd-admin@test.dev' })
  const pm = await createUser({ role: 'project_manager', email: 'vd-pm@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Nginx Gateway')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id, undefined, 'AWS Frankfurt')
  await linkProductEnvironment(product.id, env.id, { price: '10.00' })

  return {
    root,
    product,
    env,
    cat,
    rootAuth: await makeAuthHeader(root),
    adminAuth: await makeAuthHeader(admin),
    pmAuth: await makeAuthHeader(pm),
  }
}

/** Record a version, mutate the offering, record a second one. */
const twoVersions = async (mutate?: (ctx: Awaited<ReturnType<typeof setup>>) => Promise<void>) => {
  const ctx = await setup()
  await recordProductVersion({
    productId: ctx.product.id, environmentId: ctx.env.id, summary: 'v1', userId: ctx.root.id,
  })
  if (mutate) await mutate(ctx)
  else {
    await db
      .update(productEnvironments)
      .set({ price: '20.00' })
      .where(
        and(
          eq(productEnvironments.productId, ctx.product.id),
          eq(productEnvironments.environmentId, ctx.env.id),
        ),
      )
  }
  await recordProductVersion({
    productId: ctx.product.id, environmentId: ctx.env.id, summary: 'v2', userId: ctx.root.id,
  })

  const listed = await listProductVersions(ctx.product.id)
  if (!listed.ok) throw new Error('setup failed')
  return { ...ctx, newer: listed.data[0], older: listed.data[1] }
}

describe('GET /api/admin/products/{id}/versions/diff', () => {
  it('returns 401 without a token', async () => {
    const { product, older, newer } = await twoVersions()
    const res = await GET(req(`?from=${older.id}&to=${newer.id}`), p(product.id))
    expect(res.status).toBe(401)
  })

  it('returns 403 for an admin — the catalogue and its history are root-only', async () => {
    const { product, adminAuth, older, newer } = await twoVersions()
    const res = await GET(req(`?from=${older.id}&to=${newer.id}`, adminAuth), p(product.id))
    expect(res.status).toBe(403)
  })

  it('returns 403 for a project manager', async () => {
    const { product, pmAuth, older, newer } = await twoVersions()
    const res = await GET(req(`?from=${older.id}&to=${newer.id}`, pmAuth), p(product.id))
    expect(res.status).toBe(403)
  })

  it('reports a price change between two versions', async () => {
    const { product, rootAuth, older, newer } = await twoVersions()
    const res = await GET(req(`?from=${older.id}&to=${newer.id}`, rootAuth), p(product.id))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      fields: [{ field: 'price', from: '10.00', to: '20.00' }],
      parameters: [],
      identical: false,
      fromVersionId: older.id,
      toVersionId: newer.id,
    })
  })

  it('reports the direction of the comparison, so from and to are not interchangeable', async () => {
    const { product, rootAuth, older, newer } = await twoVersions()
    const res = await GET(req(`?from=${newer.id}&to=${older.id}`, rootAuth), p(product.id))
    expect(await res.json()).toMatchObject({
      fields: [{ field: 'price', from: '20.00', to: '10.00' }],
    })
  })

  it('reports two unchanged versions as identical', async () => {
    // A snapshot taken a day later is not a change: capturedAt is deliberately not
    // compared, or every diff would report a difference.
    const { product, rootAuth, older, newer } = await twoVersions(async () => {})
    const res = await GET(req(`?from=${older.id}&to=${newer.id}`, rootAuth), p(product.id))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ fields: [], parameters: [], identical: true })
  })

  it('reports a version compared with itself as identical', async () => {
    const { product, rootAuth, newer } = await twoVersions()
    const res = await GET(req(`?from=${newer.id}&to=${newer.id}`, rootAuth), p(product.id))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ identical: true })
  })

  it('reports a changed fixed billing account as an offering change', async () => {
    // Without it two versions differing only in the overhead account diffed as
    // identical, which hid a real change to who gets billed.
    const cc = await createCostCenter({ code: 'CC-OVH', name: 'Shared Platform' })
    const { product, rootAuth, older, newer } = await twoVersions(async (ctx) => {
      await db
        .update(productEnvironments)
        .set({ costCenterMode: 'overhead', overheadCostCenterId: cc.id })
        .where(
          and(
            eq(productEnvironments.productId, ctx.product.id),
            eq(productEnvironments.environmentId, ctx.env.id),
          ),
        )
    })

    const body = await (await GET(req(`?from=${older.id}&to=${newer.id}`, rootAuth), p(product.id))).json()
    expect(body.fields.map((f: { field: string }) => f.field)).toContain('overheadCostCenter')
  })

  it('reports an added parameter', async () => {
    const { product, rootAuth, older, newer } = await twoVersions(async (ctx) => {
      await db.insert(parameters).values({
        scope: 'product', scopeId: ctx.product.id, name: 'HOSTNAME', type: 'string', required: true,
      })
    })

    const body = await (await GET(req(`?from=${older.id}&to=${newer.id}`, rootAuth), p(product.id))).json()
    expect(body.parameters).toMatchObject([{ kind: 'added', name: 'HOSTNAME' }])
    expect(body.identical).toBe(false)
  })

  it('reports a removed parameter', async () => {
    // Built in order rather than through the twoVersions helper: the parameter has
    // to exist before the FIRST snapshot is taken and be gone by the second.
    const ctx = await setup()
    await db.insert(parameters).values({
      scope: 'product', scopeId: ctx.product.id, name: 'SIZE', type: 'number', required: false,
    })
    await recordProductVersion({
      productId: ctx.product.id, environmentId: ctx.env.id, summary: 'with SIZE', userId: ctx.root.id,
    })
    await db.delete(parameters).where(eq(parameters.scopeId, ctx.product.id))
    await recordProductVersion({
      productId: ctx.product.id, environmentId: ctx.env.id, summary: 'without SIZE', userId: ctx.root.id,
    })
    const listed = await listProductVersions(ctx.product.id)
    if (!listed.ok) throw new Error('setup failed')

    const body = await (
      await GET(
        req(`?from=${listed.data[1].id}&to=${listed.data[0].id}`, ctx.rootAuth),
        p(ctx.product.id),
      )
    ).json()
    expect(body.parameters).toMatchObject([{ kind: 'removed', name: 'SIZE' }])
  })

  it('reports a parameter whose definition changed', async () => {
    const ctx = await setup()
    const [param] = await db
      .insert(parameters)
      .values({ scope: 'product', scopeId: ctx.product.id, name: 'SIZE', type: 'number', required: false })
      .returning()
    await recordProductVersion({
      productId: ctx.product.id, environmentId: ctx.env.id, summary: 'optional', userId: ctx.root.id,
    })
    await db.update(parameters).set({ required: true }).where(eq(parameters.id, param.id))
    await recordProductVersion({
      productId: ctx.product.id, environmentId: ctx.env.id, summary: 'required', userId: ctx.root.id,
    })
    const listed = await listProductVersions(ctx.product.id)
    if (!listed.ok) throw new Error('setup failed')

    const body = await (
      await GET(
        req(`?from=${listed.data[1].id}&to=${listed.data[0].id}`, ctx.rootAuth),
        p(ctx.product.id),
      )
    ).json()
    expect(body.parameters).toMatchObject([
      { kind: 'changed', name: 'SIZE', fields: [{ field: 'required', from: 'false', to: 'true' }] },
    ])
  })

  it('refuses to diff a product-level entry, which carries no offering snapshot', async () => {
    // A rename is not environment-specific, so there is nothing to compare field by
    // field — and picking an arbitrary environment would be misleading.
    const ctx = await setup()
    await recordProductVersion({
      productId: ctx.product.id, environmentId: null, summary: 'renamed', userId: ctx.root.id,
    })
    await recordProductVersion({
      productId: ctx.product.id, environmentId: ctx.env.id, summary: 'priced', userId: ctx.root.id,
    })
    const listed = await listProductVersions(ctx.product.id)
    if (!listed.ok) throw new Error('setup failed')

    const res = await GET(
      req(`?from=${listed.data[1].id}&to=${listed.data[0].id}`, ctx.rootAuth),
      p(ctx.product.id),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('no configuration snapshot')
  })

  it('returns 404 when a version does not belong to this product', async () => {
    // Both ids are scoped to the product, so a version from another product cannot
    // be reached through this product's URL.
    const { cat, rootAuth, older, newer } = await twoVersions()
    const other = await createProduct(cat.id, 'Other')
    const res = await GET(req(`?from=${older.id}&to=${newer.id}`, rootAuth), p(other.id))
    expect(res.status).toBe(404)
  })

  it('returns 404 for version ids that do not exist', async () => {
    const { product, rootAuth } = await twoVersions()
    const res = await GET(req('?from=999998&to=999999', rootAuth), p(product.id))
    expect(res.status).toBe(404)
  })

  it('returns 404 when only one of the two ids is reachable', async () => {
    const { product, rootAuth, older } = await twoVersions()
    const res = await GET(req(`?from=${older.id}&to=999999`, rootAuth), p(product.id))
    expect(res.status).toBe(404)
  })

  it('returns 404 for an unknown product rather than inventing an empty diff', async () => {
    const { rootAuth, older, newer } = await twoVersions()
    const res = await GET(req(`?from=${older.id}&to=${newer.id}`, rootAuth), p(999_999))
    expect(res.status).toBe(404)
  })

  it.each(['0', '-1', 'abc', '1.5', '', ' ', '5abc', 'NaN', 'Infinity'])(
    'rejects a malformed product id (%j)',
    async (raw) => {
      const { rootAuth, older, newer } = await twoVersions()
      const res = await GET(req(`?from=${older.id}&to=${newer.id}`, rootAuth), p(raw))
      expect(res.status).toBe(400)
    },
  )

  it.each([
    '',
    '?from=1',
    '?to=1',
    '?from=&to=',
    '?from=abc&to=1',
    '?from=1&to=abc',
    '?from=0&to=1',
    '?from=1&to=-2',
    '?from=1.5&to=2',
    '?from=1&to=Infinity',
  ])('rejects missing or malformed version ids (%s)', async (query) => {
    const { product, rootAuth } = await twoVersions()
    const res = await GET(req(query, rootAuth), p(product.id))
    expect(res.status).toBe(400)
  })

  it('rejects a malformed id before the query string is even looked at', async () => {
    const { rootAuth } = await setup()
    expect((await GET(req('?from=abc&to=abc', rootAuth), p('abc'))).status).toBe(400)
  })

  // Issue #143 made digits-only the contract for a route id: `parseRouteId` in
  // lib/http.ts refuses anything `/^\d+$/` does not match, so a non-canonical
  // spelling of the product id is a 400 before the diff is ever attempted. `from`
  // and `to` are query parameters rather than route segments, so they are outside
  // that contract and still go through `Number()`; they are held canonical here so
  // the 400 is provably the path segment's doing.
  it.each([
    ['hex', (id: number) => `0x${id.toString(16)}`],
    ['exponent', (id: number) => `${id}e0`],
    ['signed', (id: number) => `+${id}`],
    ['whitespace-padded', (id: number) => ` ${id} `],
  ])('refuses a %s spelling of a real product id (#143)', async (_label, spell) => {
    const { product, rootAuth, older, newer } = await twoVersions()
    const res = await GET(req(`?from=${older.id}&to=${newer.id}`, rootAuth), p(spell(product.id)))
    expect(res.status).toBe(400)
  })
})
