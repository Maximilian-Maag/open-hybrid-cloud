import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { createUser, createCategory, createProduct, createCiSource, createEnvironment, makeAuthHeader } from '@/test/helpers'

const STEPS = [
  { template: 'linode/virtual-machine', stateSuffix: '-vm' },
  { template: 'linode/firewall', stateSuffix: '-fw', upstreamSuffix: '-vm' },
]

const makeReq = (productId: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${productId}/pipeline-stacks`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('GET /api/admin/products/[id]/pipeline-stacks', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('1'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('1', 'GET', undefined, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 403 for project_manager role', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq('1', 'GET', undefined, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 200 with empty array for product with no stacks', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const auth = await makeAuthHeader(root)
    const res = await GET(makeReq(String(p.id), 'GET', undefined, auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(0)
  })
})

describe('POST /api/admin/products/[id]/pipeline-stacks', () => {
  it('returns 401 without auth token', async () => {
    const res = await POST(makeReq('1', 'POST', {}), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(makeReq('1', 'POST', {}, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 400 when body is missing required fields', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await POST(makeReq('1', 'POST', { name: 'Stack' }, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 400 for invalid webhook URL', async () => {
    const root = await createUser({ role: 'root' })
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const auth = await makeAuthHeader(root)
    const body = { environmentId: env.id, name: 'Stack', webhookUrl: 'not-a-url', webhookToken: 'tok', steps: STEPS }
    const res = await POST(makeReq('1', 'POST', body, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(400)
  })

  it('returns 400 for empty steps array', async () => {
    const root = await createUser({ role: 'root' })
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const auth = await makeAuthHeader(root)
    const body = { environmentId: env.id, name: 'Stack', webhookUrl: 'https://hook.example.com', webhookToken: 'tok', steps: [] }
    const res = await POST(makeReq('1', 'POST', body, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(400)
  })

  it('returns 201 with created stack for valid request', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const auth = await makeAuthHeader(root)
    const body = {
      environmentId: env.id,
      name: 'VM Pipeline',
      webhookUrl: 'https://gitlab.example.com/trigger',
      webhookToken: 'secret',
      stateKeyParam: 'hostname',
      steps: STEPS,
    }
    const res = await POST(makeReq(String(p.id), 'POST', body, auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created.name).toBe('VM Pipeline')
    expect(created.stateKeyParam).toBe('hostname')
    expect(created.steps).toHaveLength(2)
    expect(created.steps[1].upstreamSuffix).toBe('-vm')
  })

  it('uses default stateKeyParam "hostname" when not provided', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const auth = await makeAuthHeader(root)
    const body = {
      environmentId: env.id,
      name: 'Stack without stateKeyParam',
      webhookUrl: 'https://gitlab.example.com/trigger',
      webhookToken: 'tok',
      steps: [{ template: 'linode/virtual-machine', stateSuffix: '-vm' }],
    }
    const res = await POST(makeReq(String(p.id), 'POST', body, auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(res.status).toBe(201)
    const created = await res.json()
    expect(created.stateKeyParam).toBe('hostname')
  })
})

describe('GET → POST progression: created stack appears in list', () => {
  it('stack created via POST is returned by subsequent GET', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const auth = await makeAuthHeader(root)

    const postRes = await POST(
      makeReq(String(p.id), 'POST', {
        environmentId: env.id,
        name: 'Progression Stack',
        webhookUrl: 'https://gitlab.example.com/trigger',
        webhookToken: 'tok',
        steps: STEPS,
      }, auth),
      { params: Promise.resolve({ id: String(p.id) }) },
    )
    expect(postRes.status).toBe(201)

    const getRes = await GET(makeReq(String(p.id), 'GET', undefined, auth), { params: Promise.resolve({ id: String(p.id) }) })
    expect(getRes.status).toBe(200)
    const list = await getRes.json()
    expect(list.some((s: { name: string }) => s.name === 'Progression Stack')).toBe(true)
  })
})
