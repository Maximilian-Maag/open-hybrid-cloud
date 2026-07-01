import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import {
  createUser,
  createCategory,
  createProduct,
  makeAuthHeader,
} from '@/test/helpers'

const makeReq = (url: string, auth?: string) =>
  new NextRequest(url, auth ? { headers: { authorization: auth } } : undefined)

describe('GET /api/catalog', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/catalog'))
    expect(res.status).toBe(401)
  })

  it('returns all products for authenticated user', async () => {
    const user = await createUser()
    const cat = await createCategory()
    await createProduct(cat.id, 'Product Alpha')
    await createProduct(cat.id, 'Product Beta')

    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/catalog', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.length).toBe(2)
  })

  it('returns empty array when no products exist', async () => {
    const user = await createUser()
    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/catalog', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  })

  it('filters by categoryId', async () => {
    const user = await createUser()
    const cat1 = await createCategory('Cat 1')
    const cat2 = await createCategory('Cat 2')
    await createProduct(cat1.id, 'Product in Cat 1')
    await createProduct(cat2.id, 'Product in Cat 2')

    const auth = await makeAuthHeader(user)
    const res = await GET(
      makeReq(`http://localhost/api/catalog?categoryId=${cat1.id}`, auth),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.length).toBe(1)
    expect(body[0].categoryId).toBe(cat1.id)
  })

  it('includes name from translations', async () => {
    const user = await createUser()
    const cat = await createCategory()
    await createProduct(cat.id, 'Named Product')

    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/catalog', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body[0].name).toBe('Named Product')
  })

  it('filters by search term', async () => {
    const user = await createUser()
    const cat = await createCategory()
    await createProduct(cat.id, 'Unique Product Name')
    await createProduct(cat.id, 'Another Item')

    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/catalog?search=Unique', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.length).toBe(1)
    expect(body[0].name).toContain('Unique')
  })
})
