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
  makeAuthHeader,
} from '@/test/helpers'

const makeReq = (id: string, auth?: string) =>
  new NextRequest(`http://localhost/api/orders/${id}`, {
    headers: auth ? { authorization: auth } : {},
  })

describe('GET /api/orders/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await GET(makeReq('1'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 for non-existent order', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq('999999', auth), { params: Promise.resolve({ id: '999999' }) })
    expect(res.status).toBe(404)
  })

  it('returns 403 when project_manager accesses another user\'s order', async () => {
    const pm1 = await createUser({ role: 'project_manager', email: 'pm1@test.dev' })
    const pm2 = await createUser({ role: 'project_manager', email: 'pm2@test.dev' })
    const cat = await createCategory()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const p = await createProduct(cat.id)
    const proj = await createProject(pm2.id)
    const order = await createOrder(proj.id, p.id, env.id, pm2.id)

    const auth = await makeAuthHeader(pm1)
    const res = await GET(makeReq(String(order.id), auth), { params: Promise.resolve({ id: String(order.id) }) })
    expect(res.status).toBe(403)
  })

  it('returns order for the owning project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const p = await createProduct(cat.id)
    const proj = await createProject(pm.id)
    const order = await createOrder(proj.id, p.id, env.id, pm.id)

    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq(String(order.id), auth), { params: Promise.resolve({ id: String(order.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(order.id)
  })

  it('admin can access any order', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    const cat = await createCategory()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const p = await createProduct(cat.id)
    const proj = await createProject(pm.id)
    const order = await createOrder(proj.id, p.id, env.id, pm.id)

    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq(String(order.id), auth), { params: Promise.resolve({ id: String(order.id) }) })
    expect(res.status).toBe(200)
  })
})
