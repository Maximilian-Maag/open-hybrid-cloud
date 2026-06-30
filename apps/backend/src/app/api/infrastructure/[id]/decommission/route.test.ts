import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
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

const makeReq = (id: string, auth?: string) =>
  new NextRequest(`http://localhost/api/infrastructure/${id}/decommission`, {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  })

describe('POST /api/infrastructure/[id]/decommission', () => {
  it('returns 401 without auth', async () => {
    const res = await POST(makeReq('1'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 for non-existent infra element', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await POST(makeReq('999999', auth), { params: Promise.resolve({ id: '999999' }) })
    expect(res.status).toBe(404)
  })

  it('returns 403 when project_manager tries to decommission another user\'s infra', async () => {
    const pm1 = await createUser({ role: 'project_manager', email: 'pm1@test.dev' })
    const pm2 = await createUser({ role: 'project_manager', email: 'pm2@test.dev' })
    const cat = await createCategory()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const p = await createProduct(cat.id)
    const proj = await createProject(pm2.id)
    const order = await createOrder(proj.id, p.id, env.id, pm2.id)
    const el = await createInfraElement(order.id, proj.id, env.id, p.id)

    const auth = await makeAuthHeader(pm1)
    const res = await POST(makeReq(String(el.id), auth), { params: Promise.resolve({ id: String(el.id) }) })
    expect(res.status).toBe(403)
  })

  it('allows project_manager to decommission own infra', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const cat = await createCategory()
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const p = await createProduct(cat.id)
    const proj = await createProject(pm.id)
    const order = await createOrder(proj.id, p.id, env.id, pm.id)
    const el = await createInfraElement(order.id, proj.id, env.id, p.id)

    const auth = await makeAuthHeader(pm)
    const res = await POST(makeReq(String(el.id), auth), { params: Promise.resolve({ id: String(el.id) }) })
    expect(res.status).toBe(200)
  })
})
