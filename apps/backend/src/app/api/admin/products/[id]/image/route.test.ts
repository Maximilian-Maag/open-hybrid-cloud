import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT, DELETE } from './route'
import { GET as SERVE } from '@/app/api/catalog/[id]/image/route'
import { db } from '@/lib/db/client'
import { products } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createUser, createCategory, createProduct, makeAuthHeader } from '@/test/helpers'

/** A real PNG signature followed by filler, so length checks see a plausible file. */
const png = () =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)])
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const webp = () =>
  Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'ascii'),
    Buffer.alloc(64, 1),
  ])
const svg = () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

const makeReq = (
  productId: string,
  auth?: string,
  payload: Buffer | null = png(),
  declaredType = 'image/png',
) => {
  const form = new FormData()
  if (payload) {
    form.append('image', new Blob([new Uint8Array(payload)], { type: declaredType }), 'image')
  }
  return new NextRequest(`http://localhost/api/admin/products/${productId}/image`, {
    method: 'PUT',
    body: form,
    headers: auth ? { authorization: auth } : {},
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const seedProduct = async () => {
  const root = await createUser({ role: 'root', email: `img-root-${Math.random()}@test.dev` })
  const cat = await createCategory()
  const product = await createProduct(cat.id)
  return { auth: await makeAuthHeader(root), product }
}

const storedImage = async (id: number) =>
  (await db.select({ image: products.image, mime: products.imageMime }).from(products).where(eq(products.id, id)))[0]

describe('PUT /api/admin/products/[id]/image', () => {
  it('returns 401 without auth', async () => {
    expect((await PUT(makeReq('1'), params('1'))).status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin', email: 'img-admin@test.dev' })
    const auth = await makeAuthHeader(admin)
    expect((await PUT(makeReq('1', auth), params('1'))).status).toBe(403)
  })

  it('stores a PNG together with its type', async () => {
    const { auth, product } = await seedProduct()
    const res = await PUT(makeReq(String(product.id), auth), params(String(product.id)))
    expect(res.status).toBe(200)

    const row = await storedImage(product.id)
    expect(row.mime).toBe('image/png')
    expect(row.image?.length).toBeGreaterThan(8)
  })

  it.each([
    ['JPEG', jpeg, 'image/jpeg'],
    ['WebP', webp, 'image/webp'],
  ])('stores a %s as its own type, not as PNG', async (_label, payload, expected) => {
    // The serving route used to answer `image/png` for every image regardless of
    // what had been uploaded.
    const { auth, product } = await seedProduct()
    await PUT(makeReq(String(product.id), auth, payload()), params(String(product.id)))

    expect((await storedImage(product.id)).mime).toBe(expected)
  })

  it('determines the type from the bytes, not from the declared Content-Type', async () => {
    // The declared type comes from the client and decides nothing.
    const { auth, product } = await seedProduct()
    await PUT(makeReq(String(product.id), auth, jpeg(), 'image/png'), params(String(product.id)))

    expect((await storedImage(product.id)).mime).toBe('image/jpeg')
  })

  it('refuses an SVG, which can carry script and is served back to browsers', async () => {
    const { auth, product } = await seedProduct()
    const res = await PUT(makeReq(String(product.id), auth, svg(), 'image/svg+xml'), params(String(product.id)))

    expect(res.status).toBe(415)
    expect((await storedImage(product.id)).image).toBeNull()
  })

  it('refuses a file that is not an image at all', async () => {
    const { auth, product } = await seedProduct()
    const res = await PUT(
      makeReq(String(product.id), auth, Buffer.from('just some text, at least twelve bytes')),
      params(String(product.id)),
    )
    expect(res.status).toBe(415)
  })

  it('refuses an oversized image', async () => {
    const { auth, product } = await seedProduct()
    const tooBig = Buffer.concat([png(), Buffer.alloc(11 * 1024 * 1024, 7)])
    const res = await PUT(makeReq(String(product.id), auth, tooBig), params(String(product.id)))

    expect(res.status).toBe(413)
    expect((await storedImage(product.id)).image).toBeNull()
  })

  it('refuses an empty file', async () => {
    const { auth, product } = await seedProduct()
    const res = await PUT(makeReq(String(product.id), auth, Buffer.alloc(0)), params(String(product.id)))
    expect(res.status).toBe(400)
  })

  it('returns 400 when no file is attached', async () => {
    const { auth, product } = await seedProduct()
    const res = await PUT(makeReq(String(product.id), auth, null), params(String(product.id)))
    expect(res.status).toBe(400)
  })

  it('returns 404 for a product that does not exist, instead of reporting success', async () => {
    // An UPDATE matching no rows is not an error, so this used to answer 200.
    const { auth } = await seedProduct()
    expect((await PUT(makeReq('999999', auth), params('999999'))).status).toBe(404)
  })

  it('serves the stored image back with the type it was stored as', async () => {
    const { auth, product } = await seedProduct()
    await PUT(makeReq(String(product.id), auth, jpeg()), params(String(product.id)))

    const res = await SERVE(new NextRequest('http://localhost/api/catalog/x/image'), params(String(product.id)))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
  })
})

describe('DELETE /api/admin/products/[id]/image', () => {
  it('removes the image and its type', async () => {
    const { auth, product } = await seedProduct()
    await PUT(makeReq(String(product.id), auth), params(String(product.id)))

    const res = await DELETE(
      new NextRequest(`http://localhost/api/admin/products/${product.id}/image`, {
        method: 'DELETE',
        headers: { authorization: auth },
      }),
      params(String(product.id)),
    )
    expect(res.status).toBe(204)

    const row = await storedImage(product.id)
    expect(row.image).toBeNull()
    expect(row.mime).toBeNull()
  })

  it('requires root', async () => {
    const admin = await createUser({ role: 'admin', email: 'img-del-admin@test.dev' })
    const auth = await makeAuthHeader(admin)
    const res = await DELETE(
      new NextRequest('http://localhost/api/admin/products/1/image', {
        method: 'DELETE',
        headers: { authorization: auth },
      }),
      params('1'),
    )
    expect(res.status).toBe(403)
  })
})
