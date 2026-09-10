import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH, DELETE } from './route'
import { POST as UPLOAD } from '../route'
import { db } from '@/lib/db/client'
import { productImages } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createUser, createCategory, createProduct, makeAuthHeader } from '@/test/helpers'

const png = () =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)])

const uploadReq = (productId: number, auth: string, alt: string) => {
  const form = new FormData()
  form.append('image', new Blob([new Uint8Array(png())], { type: 'image/png' }), 'image')
  form.append('alt', alt)
  return new NextRequest(`http://localhost/api/admin/products/${productId}/images`, {
    method: 'POST',
    body: form,
    headers: { authorization: auth },
  })
}

const patchReq = (id: string, imageId: string, auth: string | undefined, body: unknown) =>
  new NextRequest(`http://localhost/api/admin/products/${id}/images/${imageId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: auth ? { authorization: auth, 'content-type': 'application/json' } : {},
  })

const deleteReq = (id: string, imageId: string, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${id}/images/${imageId}`, {
    method: 'DELETE',
    headers: auth ? { authorization: auth } : {},
  })

const params = (id: string, imageId: string) => ({ params: Promise.resolve({ id, imageId }) })

const gallery = async (productId: number) =>
  db
    .select({
      id: productImages.id,
      position: productImages.position,
      alt: productImages.alt,
      data: productImages.data,
    })
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(productImages.position, productImages.id)

const seedGallery = async (alts = ['First', 'Second', 'Third']) => {
  const root = await createUser({ role: 'root', email: `gal-root-${Math.random()}@test.dev` })
  const auth = await makeAuthHeader(root)
  const cat = await createCategory()
  const product = await createProduct(cat.id)
  for (const alt of alts) {
    await UPLOAD(uploadReq(product.id, auth, alt), { params: Promise.resolve({ id: String(product.id) }) })
  }
  return { auth, product, rows: await gallery(product.id) }
}

describe('PATCH /api/admin/products/[id]/images/[imageId]', () => {
  it('changes the description without re-uploading the file', async () => {
    const { auth, product, rows } = await seedGallery(['Only'])
    const res = await PATCH(
      patchReq(String(product.id), String(rows[0].id), auth, { alt: 'A clearer description' }),
      params(String(product.id), String(rows[0].id)),
    )
    expect(res.status).toBe(204)

    const [after] = await gallery(product.id)
    expect(after.alt).toBe('A clearer description')
    // The bytes are untouched — this is not a re-upload.
    expect(after.data.length).toBe(rows[0].data.length)
  })

  it('refuses an empty description', async () => {
    const { auth, product, rows } = await seedGallery(['Only'])
    const res = await PATCH(
      patchReq(String(product.id), String(rows[0].id), auth, { alt: '  ' }),
      params(String(product.id), String(rows[0].id)),
    )
    expect(res.status).toBe(400)
    expect((await gallery(product.id))[0].alt).toBe('Only')
  })

  it('refuses a description longer than the limit', async () => {
    const { auth, product, rows } = await seedGallery(['Only'])
    const res = await PATCH(
      patchReq(String(product.id), String(rows[0].id), auth, { alt: 'x'.repeat(301) }),
      params(String(product.id), String(rows[0].id)),
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 for an image that does not exist', async () => {
    const { auth, product } = await seedGallery(['Only'])
    const res = await PATCH(
      patchReq(String(product.id), '999999', auth, { alt: 'Describes nothing' }),
      params(String(product.id), '999999'),
    )
    expect(res.status).toBe(404)
  })

  it("will not describe another product's picture", async () => {
    // The image id alone is not authorisation to touch it — the URL names a
    // product, and a mismatched pair is a 404 rather than a silent cross-product
    // write.
    const mine = await seedGallery(['Mine'])
    const theirs = await seedGallery(['Theirs'])

    const res = await PATCH(
      patchReq(String(mine.product.id), String(theirs.rows[0].id), mine.auth, { alt: 'Hijacked' }),
      params(String(mine.product.id), String(theirs.rows[0].id)),
    )
    expect(res.status).toBe(404)
    expect((await gallery(theirs.product.id))[0].alt).toBe('Theirs')
  })

  it('rejects a partially numeric id on either segment', async () => {
    const { auth, product, rows } = await seedGallery(['Only'])
    const badProduct = `${product.id}abc`
    const badImage = `${rows[0].id}abc`

    expect(
      (await PATCH(patchReq(badProduct, String(rows[0].id), auth, { alt: 'x' }), params(badProduct, String(rows[0].id)))).status,
    ).toBe(400)
    expect(
      (await PATCH(patchReq(String(product.id), badImage, auth, { alt: 'x' }), params(String(product.id), badImage))).status,
    ).toBe(400)
    expect((await gallery(product.id))[0].alt).toBe('Only')
  })

  it('requires root', async () => {
    const admin = await createUser({ role: 'admin', email: 'gal-patch-admin@test.dev' })
    const auth = await makeAuthHeader(admin)
    expect((await PATCH(patchReq('1', '1', auth, { alt: 'x' }), params('1', '1'))).status).toBe(403)
  })

  it('returns 401 without auth', async () => {
    expect((await PATCH(patchReq('1', '1', undefined, { alt: 'x' }), params('1', '1'))).status).toBe(401)
  })
})

describe('DELETE /api/admin/products/[id]/images/[imageId]', () => {
  it('removes one picture and closes the gap in the order', async () => {
    const { auth, product, rows } = await seedGallery()

    const res = await DELETE(
      deleteReq(String(product.id), String(rows[1].id), auth),
      params(String(product.id), String(rows[1].id)),
    )
    expect(res.status).toBe(204)

    // Dense positions, or a later reorder and this list would disagree about what
    // position 1 is.
    expect(await gallery(product.id)).toEqual([
      expect.objectContaining({ alt: 'First', position: 0 }),
      expect.objectContaining({ alt: 'Third', position: 1 }),
    ])
  })

  it('returns 404 for an image that does not exist', async () => {
    const { auth, product } = await seedGallery(['Only'])
    expect(
      (await DELETE(deleteReq(String(product.id), '999999', auth), params(String(product.id), '999999'))).status,
    ).toBe(404)
  })

  it("will not delete another product's picture", async () => {
    const mine = await seedGallery(['Mine'])
    const theirs = await seedGallery(['Theirs'])

    const res = await DELETE(
      deleteReq(String(mine.product.id), String(theirs.rows[0].id), mine.auth),
      params(String(mine.product.id), String(theirs.rows[0].id)),
    )
    expect(res.status).toBe(404)
    expect(await gallery(theirs.product.id)).toHaveLength(1)
  })

  it('rejects a partially numeric id and touches nothing', async () => {
    const { auth, product, rows } = await seedGallery(['Only'])
    const bad = `${rows[0].id}abc`
    expect(
      (await DELETE(deleteReq(String(product.id), bad, auth), params(String(product.id), bad))).status,
    ).toBe(400)
    expect(await gallery(product.id)).toHaveLength(1)
  })

  it('requires root', async () => {
    const admin = await createUser({ role: 'admin', email: 'gal-del-admin@test.dev' })
    const auth = await makeAuthHeader(admin)
    expect((await DELETE(deleteReq('1', '1', auth), params('1', '1'))).status).toBe(403)
  })
})
