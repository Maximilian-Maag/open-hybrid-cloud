import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { db } from '@/lib/db/client'
import { products } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createCategory, createProduct } from '@/test/helpers'

const makeReq = (id: string) =>
  new NextRequest(`http://localhost/api/catalog/${id}/image`)

describe('GET /api/catalog/[id]/image', () => {
  it('returns the raw image bytes with the correct content-type', async () => {
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'WithImage')
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await db.update(products).set({ image: png }).where(eq(products.id, p.id))

    const res = await GET(makeReq(String(p.id)), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.equals(png)).toBe(true)
  })

  it('returns 404 when the product has no image (bytea NULL)', async () => {
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'NoImage')
    const res = await GET(makeReq(String(p.id)), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(404)
  })

  it('returns 404 when the product does not exist', async () => {
    const res = await GET(makeReq('999999'), { params: Promise.resolve({ id: '999999' }) })
    expect(res.status).toBe(404)
  })

  it('sets a Cache-Control hint so browsers can cache within an hour', async () => {
    const cat = await createCategory()
    const p = await createProduct(cat.id, 'Cached')
    await db.update(products).set({ image: Buffer.from([1, 2, 3]) }).where(eq(products.id, p.id))

    const res = await GET(makeReq(String(p.id)), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.headers.get('cache-control')).toContain('max-age=3600')
  })
})
