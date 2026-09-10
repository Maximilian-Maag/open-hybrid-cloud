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
import { productEnvironments, parameters } from '@/lib/db/schema'

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

  // Issue #131: this endpoint is requireAuth only, so a cleartext default here is
  // readable by every account in the portal. Asserted against the whole response
  // text, not just the field: the value must not be anywhere in what goes over the
  // wire, whatever shape the payload grows into.
  it('never serves the default of a sensitive parameter', async () => {
    const user = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    await db.insert(parameters).values([
      {
        scope: 'product',
        scopeId: product.id,
        name: 'ADMIN_PASSWORD',
        label: 'Admin password',
        type: 'string',
        defaultValue: 'sup3rs3cret-default',
        required: true,
        sensitive: true,
      },
      { scope: 'product', scopeId: product.id, name: 'HOSTNAME', type: 'string', defaultValue: 'web-01' },
    ])

    const auth = await makeAuthHeader(user)
    // Both shapes the endpoint answers in: with an environment (resolved) and
    // without (resolved per environment) — they go through different collapsing.
    for (const query of ['', `?environmentId=${env.id}`]) {
      const res = await GET(
        makeReq(`http://localhost/api/catalog/${product.id}${query}`, auth),
        { params: Promise.resolve({ id: String(product.id) }) },
      )
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text, `query "${query}"`).not.toContain('sup3rs3cret-default')

      // The DEFINITION still has to arrive — the order form needs the control, and
      // needs to know to render it as a secret. Only the value is gone.
      const body = JSON.parse(text)
      const secret = body.parameters.find((p: { name: string }) => p.name === 'ADMIN_PASSWORD')
      expect(secret).toMatchObject({
        name: 'ADMIN_PASSWORD',
        label: 'Admin password',
        type: 'string',
        required: true,
        sensitive: true,
        defaultValue: '',
      })
      // A non-sensitive default is not a secret and must still be prefilled.
      expect(body.parameters.find((p: { name: string }) => p.name === 'HOSTNAME').defaultValue).toBe('web-01')
    }
  })
})
