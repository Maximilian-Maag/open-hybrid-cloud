import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder,
  createInfraElement,
  makeAuthHeader,
} from '@/test/helpers'

const makeReq = (url: string, auth?: string) =>
  new NextRequest(url, auth ? { headers: { authorization: auth } } : undefined)

describe('GET /api/infrastructure', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/infrastructure'))
    expect(res.status).toBe(401)
  })

  it('admin sees all infrastructure elements', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm1 = await createUser({ role: 'project_manager' })
    const pm2 = await createUser({ role: 'project_manager' })

    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    const proj1 = await createProject(pm1.id)
    const proj2 = await createProject(pm2.id)

    const order1 = await createOrder(proj1.id, product.id, env.id, pm1.id)
    const order2 = await createOrder(proj2.id, product.id, env.id, pm2.id)

    await createInfraElement(order1.id, proj1.id, env.id, product.id)
    await createInfraElement(order2.id, proj2.id, env.id, product.id)

    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/infrastructure', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.length).toBe(2)
  })

  it('project_manager only sees own projects infrastructure', async () => {
    const pm1 = await createUser({ role: 'project_manager' })
    const pm2 = await createUser({ role: 'project_manager' })

    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    const proj1 = await createProject(pm1.id)
    const proj2 = await createProject(pm2.id)

    const order1 = await createOrder(proj1.id, product.id, env.id, pm1.id)
    const order2 = await createOrder(proj2.id, product.id, env.id, pm2.id)

    await createInfraElement(order1.id, proj1.id, env.id, product.id)
    await createInfraElement(order2.id, proj2.id, env.id, product.id)

    const auth = await makeAuthHeader(pm1)
    const res = await GET(makeReq('http://localhost/api/infrastructure', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    // pm1 only sees infra from their own project
    expect(body.length).toBe(1)
    expect(body[0].projectId).toBe(proj1.id)
  })

  it('filters by productId', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })

    const cat = await createCategory()
    const prod1 = await createProduct(cat.id, 'Product A')
    const prod2 = await createProduct(cat.id, 'Product B')
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const proj = await createProject(pm.id)

    const ord1 = await createOrder(proj.id, prod1.id, env.id, pm.id)
    const ord2 = await createOrder(proj.id, prod2.id, env.id, pm.id)

    await createInfraElement(ord1.id, proj.id, env.id, prod1.id)
    await createInfraElement(ord2.id, proj.id, env.id, prod2.id)

    const auth = await makeAuthHeader(admin)
    const res = await GET(
      makeReq(`http://localhost/api/infrastructure?productId=${prod1.id}`, auth),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.length).toBe(1)
    expect(body[0].productId).toBe(prod1.id)
  })

  it('filters by projectId', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })

    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    const proj1 = await createProject(pm.id)
    const proj2 = await createProject(pm.id)

    const ord1 = await createOrder(proj1.id, product.id, env.id, pm.id)
    const ord2 = await createOrder(proj2.id, product.id, env.id, pm.id)

    await createInfraElement(ord1.id, proj1.id, env.id, product.id)
    await createInfraElement(ord2.id, proj2.id, env.id, product.id)

    const auth = await makeAuthHeader(admin)
    const res = await GET(
      makeReq(`http://localhost/api/infrastructure?projectId=${proj1.id}`, auth),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.length).toBe(1)
    expect(body[0].projectId).toBe(proj1.id)
  })

  it('returns empty array when no infra elements exist', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/infrastructure', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  })
})
