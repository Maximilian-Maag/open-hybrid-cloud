import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { createCategory, createProduct, createProductImage } from '@/test/helpers'

const makeReq = (id: string) =>
  new NextRequest(`http://localhost/api/catalog/${id}/image`)

const call = (id: string) => GET(makeReq(id), { params: Promise.resolve({ id }) })

describe('GET /api/catalog/[id]/image', () => {
  it('returns the raw image bytes with the correct content-type', async () => {
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'WithImage')
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await createProductImage(p.id, { data: png })

    const res = await call(String(p.id))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.equals(png)).toBe(true)
  })

  it('serves the first picture of the gallery, not an arbitrary one', async () => {
    // What this endpoint means after #107: the picture the product leads with, so
    // the tile, the cart row and the detail page agree on which one that is.
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'Gallery')
    await createProductImage(p.id, { position: 1, data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), mime: 'image/jpeg' })
    const first = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
    await createProductImage(p.id, { position: 0, data: first })

    const res = await call(String(p.id))
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await res.arrayBuffer()).equals(first)).toBe(true)
  })

  it('returns 404 when the product has no picture at all', async () => {
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'NoImage')
    expect((await call(String(p.id))).status).toBe(404)
  })

  it('returns 404 when the product does not exist', async () => {
    expect((await call('999999')).status).toBe(404)
  })

  it('serves without an Authorization header, agreeing with the gallery route', async () => {
    // The same pinned contract as /catalog/{id}/images/{imageId}: both are read by
    // an image tag, which sends no bearer token and no cross-origin cookie.
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'Anon')
    await createProductImage(p.id, { data: Buffer.from([1, 2, 3]) })

    expect((await call(String(p.id))).status).toBe(200)
  })

  it('sets a Cache-Control hint so browsers can cache within an hour', async () => {
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'Cached')
    await createProductImage(p.id, { data: Buffer.from([1, 2, 3]) })

    expect((await call(String(p.id))).headers.get('cache-control')).toContain('max-age=3600')
  })
})
