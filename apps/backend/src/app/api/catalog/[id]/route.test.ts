import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  makeAuthHeader,
} from '@/test/helpers'
import { db } from '@/lib/db/client'
import { productEnvironments } from '@/lib/db/schema'

const makeReq = (url: string, auth?: string) =>
  new NextRequest(url, auth ? { headers: { authorization: auth } } : undefined)

describe('GET /api/catalog/[id]', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/catalog/1'), {
      params: Promise.resolve({ id: '1' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 404 for non-existent product', async () => {
    const user = await createUser()
    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/catalog/999999', auth), {
      params: Promise.resolve({ id: '999999' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns product with name from translation', async () => {
    const user = await createUser()
    const cat = await createCategory()
    const product = await createProduct(cat.id, 'Catalog Product')

    const auth = await makeAuthHeader(user)
    const res = await GET(
      makeReq(`http://localhost/api/catalog/${product.id}`, auth),
      { params: Promise.resolve({ id: String(product.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(product.id)
    expect(body.name).toBe('Catalog Product')
  })

  it('returns environments array', async () => {
    const user = await createUser()
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    // Link product to environment
    await db.insert(productEnvironments).values({
      productId: product.id,
      environmentId: env.id,
      price: '100',
      currency: 'EUR',
      costCenterMode: 'project',
      forcedCostCenter: false,
    })

    const auth = await makeAuthHeader(user)
    const res = await GET(
      makeReq(`http://localhost/api/catalog/${product.id}`, auth),
      { params: Promise.resolve({ id: String(product.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.environments)).toBe(true)
    expect(body.environments.length).toBe(1)
    expect(body.environments[0].environmentId).toBe(env.id)
  })

  it('returns parameters array', async () => {
    const user = await createUser()
    const cat = await createCategory()
    const product = await createProduct(cat.id)

    const auth = await makeAuthHeader(user)
    const res = await GET(
      makeReq(`http://localhost/api/catalog/${product.id}`, auth),
      { params: Promise.resolve({ id: String(product.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.parameters)).toBe(true)
  })
})
