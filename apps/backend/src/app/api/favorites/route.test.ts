import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { PUT, DELETE } from './[productId]/route'
import { createUser, makeAuthHeader, createCategory, createProduct } from '@/test/helpers'

const makeReq = (url: string, auth?: string) =>
  new NextRequest(url, auth ? { headers: { authorization: auth } } : undefined)

const params = (productId: string | number) => ({ params: Promise.resolve({ productId: String(productId) }) })

const setup = async () => {
  const user = await createUser({ role: 'project_manager', email: 'fav-route@test.dev' })
  const other = await createUser({ role: 'admin', email: 'fav-route-other@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Nginx Gateway')
  return { user, other, product, auth: await makeAuthHeader(user), otherAuth: await makeAuthHeader(other) }
}

describe('favorites API', () => {
  it('requires authentication on every verb', async () => {
    const { product } = await setup()
    expect((await GET(makeReq('http://localhost/api/favorites'))).status).toBe(401)
    expect((await PUT(makeReq('http://localhost/api/favorites/1'), params(product.id))).status).toBe(401)
    expect((await DELETE(makeReq('http://localhost/api/favorites/1'), params(product.id))).status).toBe(401)
  })

  it('is available to a project manager — favourites are not an admin feature', async () => {
    const { product, auth } = await setup()
    const res = await PUT(makeReq('http://localhost/api/favorites', auth), params(product.id))
    expect(res.status).toBe(200)
  })

  it('round-trips a favourite through PUT, GET and DELETE', async () => {
    const { product, auth } = await setup()

    await PUT(makeReq('http://localhost/api/favorites', auth), params(product.id))
    const listed = await GET(makeReq('http://localhost/api/favorites?lang=en', auth))
    expect(listed.status).toBe(200)
    expect(await listed.json()).toMatchObject([{ productId: product.id, name: 'Nginx Gateway' }])

    await DELETE(makeReq('http://localhost/api/favorites', auth), params(product.id))
    const after = await GET(makeReq('http://localhost/api/favorites?lang=en', auth))
    expect(await after.json()).toEqual([])
  })

  it('scopes the list to the calling user', async () => {
    // The user id comes from the session and is never read off the request, so
    // one user's favourites can never appear in another's list.
    const { product, auth, otherAuth } = await setup()
    await PUT(makeReq('http://localhost/api/favorites', auth), params(product.id))

    const theirs = await GET(makeReq('http://localhost/api/favorites?lang=en', otherAuth))
    expect(await theirs.json()).toEqual([])
  })

  it('returns 404 for an unknown product', async () => {
    const { auth } = await setup()
    const res = await PUT(makeReq('http://localhost/api/favorites', auth), params(999_999))
    expect(res.status).toBe(404)
  })

  it.each(['0', '-1', 'abc', '1.5'])('rejects a malformed product id (%s)', async (raw) => {
    const { auth } = await setup()
    const res = await PUT(makeReq('http://localhost/api/favorites', auth), params(raw))
    expect(res.status).toBe(400)
  })

  it('defaults to English when no lang is given', async () => {
    const { product, auth } = await setup()
    await PUT(makeReq('http://localhost/api/favorites', auth), params(product.id))

    const res = await GET(makeReq('http://localhost/api/favorites', auth))
    expect(await res.json()).toMatchObject([{ name: 'Nginx Gateway' }])
  })
})
