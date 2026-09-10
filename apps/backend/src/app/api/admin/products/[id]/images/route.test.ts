import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST, PATCH } from './route'
import { GET as SERVE_PRIMARY } from '@/app/api/catalog/[id]/image/route'
import { GET as SERVE_ONE } from '@/app/api/catalog/[id]/images/[imageId]/route'
import { db } from '@/lib/db/client'
import { productImages } from '@/lib/db/schema'
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

const uploadReq = (
  productId: string,
  auth?: string,
  payload: Buffer | null = png(),
  declaredType = 'image/png',
  alt: string | null = 'A dashboard showing traffic graphs',
) => {
  const form = new FormData()
  if (payload) {
    form.append('image', new Blob([new Uint8Array(payload)], { type: declaredType }), 'image')
  }
  if (alt !== null) form.append('alt', alt)
  return new NextRequest(`http://localhost/api/admin/products/${productId}/images`, {
    method: 'POST',
    body: form,
    headers: auth ? { authorization: auth } : {},
  })
}

const listReq = (id: string, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${id}/images`, {
    headers: auth ? { authorization: auth } : {},
  })

const reorderReq = (id: string, auth: string | undefined, body: unknown) =>
  new NextRequest(`http://localhost/api/admin/products/${id}/images`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: auth ? { authorization: auth, 'content-type': 'application/json' } : {},
  })

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const seedProduct = async () => {
  const root = await createUser({ role: 'root', email: `img-root-${Math.random()}@test.dev` })
  const cat = await createCategory()
  const product = await createProduct(cat.id)
  return { auth: await makeAuthHeader(root), product }
}

const gallery = async (productId: number) =>
  db
    .select({
      id: productImages.id,
      position: productImages.position,
      mime: productImages.mime,
      alt: productImages.alt,
      data: productImages.data,
    })
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(productImages.position, productImages.id)

describe('POST /api/admin/products/[id]/images', () => {
  it('returns 401 without auth', async () => {
    expect((await POST(uploadReq('1'), params('1'))).status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin', email: 'img-admin@test.dev' })
    const auth = await makeAuthHeader(admin)
    expect((await POST(uploadReq('1', auth), params('1'))).status).toBe(403)
  })

  it('stores a PNG together with its type', async () => {
    const { auth, product } = await seedProduct()
    const res = await POST(uploadReq(String(product.id), auth), params(String(product.id)))
    expect(res.status).toBe(201)

    const [row] = await gallery(product.id)
    expect(row.mime).toBe('image/png')
    expect(row.position).toBe(0)
    expect(row.data.length).toBeGreaterThan(8)
  })

  it('appends rather than replacing, which is the point of the gallery (#107)', async () => {
    const { auth, product } = await seedProduct()
    await POST(uploadReq(String(product.id), auth, png(), 'image/png', 'First'), params(String(product.id)))
    await POST(uploadReq(String(product.id), auth, jpeg(), 'image/jpeg', 'Second'), params(String(product.id)))

    const rows = await gallery(product.id)
    expect(rows.map((r) => [r.position, r.alt])).toEqual([
      [0, 'First'],
      [1, 'Second'],
    ])
  })

  it.each([
    ['JPEG', jpeg, 'image/jpeg'],
    ['WebP', webp, 'image/webp'],
  ])('stores a %s as its own type, not as PNG', async (_label, payload, expected) => {
    // The serving route used to answer `image/png` for every image regardless of
    // what had been uploaded.
    const { auth, product } = await seedProduct()
    await POST(uploadReq(String(product.id), auth, payload()), params(String(product.id)))

    expect((await gallery(product.id))[0].mime).toBe(expected)
  })

  it('determines the type from the bytes, not from the declared Content-Type', async () => {
    // The declared type comes from the client and decides nothing.
    const { auth, product } = await seedProduct()
    await POST(uploadReq(String(product.id), auth, jpeg(), 'image/png'), params(String(product.id)))

    expect((await gallery(product.id))[0].mime).toBe('image/jpeg')
  })

  it('refuses an SVG, which can carry script and is served back to browsers', async () => {
    const { auth, product } = await seedProduct()
    const res = await POST(
      uploadReq(String(product.id), auth, svg(), 'image/svg+xml'),
      params(String(product.id)),
    )

    expect(res.status).toBe(415)
    expect(await gallery(product.id)).toHaveLength(0)
  })

  it('refuses a file that is not an image at all', async () => {
    const { auth, product } = await seedProduct()
    const res = await POST(
      uploadReq(String(product.id), auth, Buffer.from('just some text, at least twelve bytes')),
      params(String(product.id)),
    )
    expect(res.status).toBe(415)
  })

  it('refuses an oversized image', async () => {
    const { auth, product } = await seedProduct()
    const tooBig = Buffer.concat([png(), Buffer.alloc(11 * 1024 * 1024, 7)])
    const res = await POST(uploadReq(String(product.id), auth, tooBig), params(String(product.id)))

    expect(res.status).toBe(413)
    expect(await gallery(product.id)).toHaveLength(0)
  })

  it('refuses an oversized image whose declared length is a lie', async () => {
    // The Content-Length pre-check is a cheap first pass over a header the client
    // controls. The size of the uploaded part is the fact, so understating the
    // header must not buy a client a stored image over the limit.
    const { auth, product } = await seedProduct()
    const tooBig = Buffer.concat([png(), Buffer.alloc(11 * 1024 * 1024, 7)])
    const req = uploadReq(String(product.id), auth, tooBig)
    req.headers.set('content-length', '128')

    const res = await POST(req, params(String(product.id)))
    expect(res.status).toBe(413)
    expect(await gallery(product.id)).toHaveLength(0)
  })

  it('refuses an empty file', async () => {
    const { auth, product } = await seedProduct()
    const res = await POST(
      uploadReq(String(product.id), auth, Buffer.alloc(0)),
      params(String(product.id)),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when no file is attached', async () => {
    const { auth, product } = await seedProduct()
    const res = await POST(uploadReq(String(product.id), auth, null), params(String(product.id)))
    expect(res.status).toBe(400)
  })

  it('returns 404 for a product that does not exist, instead of a driver error', async () => {
    const { auth } = await seedProduct()
    expect((await POST(uploadReq('999999', auth), params('999999'))).status).toBe(404)
  })

  it('refuses more images than a gallery is allowed to hold', async () => {
    const { auth, product } = await seedProduct()
    for (let i = 0; i < 8; i += 1) {
      const res = await POST(
        uploadReq(String(product.id), auth, png(), 'image/png', `Picture ${i}`),
        params(String(product.id)),
      )
      expect(res.status).toBe(201)
    }

    const res = await POST(
      uploadReq(String(product.id), auth, png(), 'image/png', 'One too many'),
      params(String(product.id)),
    )
    expect(res.status).toBe(409)
    expect(await gallery(product.id)).toHaveLength(8)
  })

  it('rejects a partially numeric product id and touches nothing', async () => {
    // parseInt('1abc') is 1, so an upload to /products/1abc/images would append to
    // the gallery of a product the caller never named.
    const { auth, product } = await seedProduct()
    const bad = `${product.id}abc`
    expect((await POST(uploadReq(bad, auth), params(bad))).status).toBe(400)
    expect(await gallery(product.id)).toHaveLength(0)
  })
})

describe('POST /api/admin/products/[id]/images — description (#105)', () => {
  it('stores the description alongside the image', async () => {
    const { auth, product } = await seedProduct()
    await POST(
      uploadReq(String(product.id), auth, png(), 'image/png', 'Traffic graphs for the managed gateway'),
      params(String(product.id)),
    )

    expect((await gallery(product.id))[0].alt).toBe('Traffic graphs for the managed gateway')
  })

  it('refuses an image with no description', async () => {
    // An empty alt is a claim that the picture carries no information, and only
    // the person uploading it can make that claim.
    const { auth, product } = await seedProduct()
    const res = await POST(
      uploadReq(String(product.id), auth, png(), 'image/png', null),
      params(String(product.id)),
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/description is required/i)
    expect(await gallery(product.id)).toHaveLength(0)
  })

  it('refuses a description of only whitespace', async () => {
    const { auth, product } = await seedProduct()
    const res = await POST(
      uploadReq(String(product.id), auth, png(), 'image/png', '   '),
      params(String(product.id)),
    )
    expect(res.status).toBe(400)
  })

  it('refuses a description longer than the limit', async () => {
    const { auth, product } = await seedProduct()
    const res = await POST(
      uploadReq(String(product.id), auth, png(), 'image/png', 'x'.repeat(301)),
      params(String(product.id)),
    )
    expect(res.status).toBe(400)
  })

  it('trims the description before storing it', async () => {
    const { auth, product } = await seedProduct()
    await POST(
      uploadReq(String(product.id), auth, png(), 'image/png', '  a gateway  '),
      params(String(product.id)),
    )
    expect((await gallery(product.id))[0].alt).toBe('a gateway')
  })
})

describe('GET /api/admin/products/[id]/images', () => {
  it('lists the gallery in order, without the bytes', async () => {
    const { auth, product } = await seedProduct()
    await POST(uploadReq(String(product.id), auth, png(), 'image/png', 'First'), params(String(product.id)))
    await POST(uploadReq(String(product.id), auth, jpeg(), 'image/jpeg', 'Second'), params(String(product.id)))

    const res = await GET(listReq(String(product.id), auth), params(String(product.id)))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.map((row: { alt: string }) => row.alt)).toEqual(['First', 'Second'])
    // The bytes are what the image routes are for; a list of eight 10 MB blobs is
    // not a JSON payload.
    expect(body[0].data).toBeUndefined()
  })

  it('answers an empty list for a product with no pictures, and 404 for no product', async () => {
    const { auth, product } = await seedProduct()
    expect(await (await GET(listReq(String(product.id), auth), params(String(product.id)))).json()).toEqual([])
    expect((await GET(listReq('999999', auth), params('999999'))).status).toBe(404)
  })

  it('requires root', async () => {
    const admin = await createUser({ role: 'admin', email: 'img-list-admin@test.dev' })
    const auth = await makeAuthHeader(admin)
    expect((await GET(listReq('1', auth), params('1'))).status).toBe(403)
  })
})

describe('PATCH /api/admin/products/[id]/images — reorder', () => {
  const seedThree = async () => {
    const { auth, product } = await seedProduct()
    for (const alt of ['First', 'Second', 'Third']) {
      await POST(uploadReq(String(product.id), auth, png(), 'image/png', alt), params(String(product.id)))
    }
    return { auth, product, rows: await gallery(product.id) }
  }

  it('puts the gallery into the given order', async () => {
    const { auth, product, rows } = await seedThree()
    const order = [rows[2].id, rows[0].id, rows[1].id]

    const res = await PATCH(reorderReq(String(product.id), auth, { order }), params(String(product.id)))
    expect(res.status).toBe(204)

    expect((await gallery(product.id)).map((r) => r.alt)).toEqual(['Third', 'First', 'Second'])
  })

  it('changes which picture the primary image endpoint serves', async () => {
    // The tile, the cart row and the favourites card all read /catalog/{id}/image,
    // so "first in the gallery" has to be the same thing everywhere.
    const { auth, product, rows } = await seedThree()
    await PATCH(
      reorderReq(String(product.id), auth, { order: [rows[1].id, rows[0].id, rows[2].id] }),
      params(String(product.id)),
    )

    const served = await SERVE_PRIMARY(
      new NextRequest('http://localhost/api/catalog/x/image'),
      params(String(product.id)),
    )
    const expected = await SERVE_ONE(
      new NextRequest('http://localhost/api/catalog/x/images/y'),
      { params: Promise.resolve({ id: String(product.id), imageId: String(rows[1].id) }) },
    )
    expect(served.status).toBe(200)
    expect(Buffer.from(await served.arrayBuffer())).toEqual(
      Buffer.from(await expected.arrayBuffer()),
    )
  })

  it('refuses a partial order rather than half-applying it', async () => {
    const { auth, product, rows } = await seedThree()
    const res = await PATCH(
      reorderReq(String(product.id), auth, { order: [rows[1].id, rows[0].id] }),
      params(String(product.id)),
    )

    expect(res.status).toBe(400)
    expect((await gallery(product.id)).map((r) => r.alt)).toEqual(['First', 'Second', 'Third'])
  })

  it('refuses an order that repeats an image', async () => {
    const { auth, product, rows } = await seedThree()
    const res = await PATCH(
      reorderReq(String(product.id), auth, { order: [rows[0].id, rows[0].id, rows[1].id] }),
      params(String(product.id)),
    )
    expect(res.status).toBe(400)
  })

  it("refuses an id from another product's gallery", async () => {
    const { auth, product, rows } = await seedThree()
    const other = await seedProduct()
    await POST(uploadReq(String(other.product.id), other.auth), params(String(other.product.id)))
    const [foreign] = await gallery(other.product.id)

    const res = await PATCH(
      reorderReq(String(product.id), auth, { order: [rows[0].id, rows[1].id, foreign.id] }),
      params(String(product.id)),
    )
    expect(res.status).toBe(400)
    expect((await gallery(other.product.id))[0].position).toBe(0)
  })

  it('refuses a body that is not a list of ids', async () => {
    const { auth, product } = await seedProduct()
    for (const body of [{}, { order: 'first' }, { order: [0] }, { order: [1.5] }]) {
      expect((await PATCH(reorderReq(String(product.id), auth, body), params(String(product.id)))).status).toBe(400)
    }
  })

  it('requires root', async () => {
    const admin = await createUser({ role: 'admin', email: 'img-reorder-admin@test.dev' })
    const auth = await makeAuthHeader(admin)
    expect((await PATCH(reorderReq('1', auth, { order: [1] }), params('1'))).status).toBe(403)
  })
})
