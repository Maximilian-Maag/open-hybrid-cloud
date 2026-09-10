import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { createCategory, createProduct, createProductImage } from '@/test/helpers'

const call = (id: string, imageId: string) =>
  GET(new NextRequest(`http://localhost/api/catalog/${id}/images/${imageId}`), {
    params: Promise.resolve({ id, imageId }),
  })

describe('GET /api/catalog/[id]/images/[imageId]', () => {
  it('serves one gallery picture with its own stored type', async () => {
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'Gallery')
    await createProductImage(p.id, { position: 0 })
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x07])
    const second = await createProductImage(p.id, { position: 1, data: jpeg, mime: 'image/jpeg' })

    const res = await call(String(p.id), String(second.id))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(Buffer.from(await res.arrayBuffer()).equals(jpeg)).toBe(true)
    expect(res.headers.get('cache-control')).toContain('max-age=3600')
  })

  it("404s for an image that belongs to a different product", async () => {
    // A gallery URL is scoped to its product, so a stale or guessed id cannot be
    // walked across the catalogue.
    const cat = await createCategory()
    const mine = await createProduct(cat.id, 'Mine')
    const theirs = await createProduct(cat.id, 'Theirs')
    const foreign = await createProductImage(theirs.id)

    expect((await call(String(mine.id), String(foreign.id))).status).toBe(404)
  })

  it('404s for an image id that does not exist', async () => {
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'Empty')
    expect((await call(String(p.id), '999999')).status).toBe(404)
  })

  it('serves without an Authorization header, agreeing with /catalog/{id}/image', async () => {
    // Pinned rather than incidental: the routes either side of this one require a
    // bearer token, and the reason these two do not is that a browser image request
    // cannot carry one. Flipping this to requireAuth breaks every picture in the
    // app, so it should fail here first.
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'Anon')
    const image = await createProductImage(p.id)

    const res = await call(String(p.id), String(image.id))
    expect(res.status).toBe(200)
  })

  it('400s on an id that is not a plain number', async () => {
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'Bad')
    const image = await createProductImage(p.id)

    expect((await call(`${p.id}abc`, String(image.id))).status).toBe(400)
    expect((await call(String(p.id), `${image.id}abc`)).status).toBe(400)
  })
})
