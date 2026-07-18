import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT, DELETE } from './route'
import { createUser, createCategory, createProduct, createCiSource, createEnvironment, makeAuthHeader } from '@/test/helpers'
import { db } from '@/lib/db/client'
import { pipelineStacks } from '@/lib/db/schema'
import { GET, POST } from '../route'

const STEPS = [
  { template: 'linode/virtual-machine', stateSuffix: '-vm' },
  { template: 'linode/firewall', stateSuffix: '-fw', upstreamSuffix: '-vm' },
]

const makeReq = (productId: string, stackId: string, method: string, body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${productId}/pipeline-stacks/${stackId}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

const makeListReq = (productId: string, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/products/${productId}/pipeline-stacks`, {
    headers: { ...(auth ? { authorization: auth } : {}) },
  })

const seedStack = async () => {
  const cat = await createCategory()
  const p = await createProduct(cat.id)
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const [stack] = await db.insert(pipelineStacks).values({
    productId: p.id,
    environmentId: env.id,
    name: 'Seed Stack',
    webhookUrl: 'https://gitlab.example.com/trigger',
    webhookToken: 'secret',
    stateKeyParam: 'hostname',
    steps: STEPS,
  }).returning()
  return { p, env, stack }
}

describe('PUT /api/admin/products/[id]/pipeline-stacks/[stackId]', () => {
  it('returns 401 without auth token', async () => {
    const res = await PUT(makeReq('1', '1', 'PUT', { name: 'x' }), { params: Promise.resolve({ id: '1', stackId: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await PUT(makeReq('1', '1', 'PUT', { name: 'x' }, auth), { params: Promise.resolve({ id: '1', stackId: '1' }) })
    expect(res.status).toBe(403)
  })

  it('updates name for root user', async () => {
    const root = await createUser({ role: 'root' })
    const { p, stack } = await seedStack()
    const auth = await makeAuthHeader(root)
    const res = await PUT(
      makeReq(String(p.id), String(stack.id), 'PUT', { name: 'Renamed Stack' }, auth),
      { params: Promise.resolve({ id: String(p.id), stackId: String(stack.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Renamed Stack')
    expect(body.stateKeyParam).toBe('hostname')
  })

  it('updates stateKeyParam for root user', async () => {
    const root = await createUser({ role: 'root' })
    const { p, stack } = await seedStack()
    const auth = await makeAuthHeader(root)
    const res = await PUT(
      makeReq(String(p.id), String(stack.id), 'PUT', { stateKeyParam: 'vm_name' }, auth),
      { params: Promise.resolve({ id: String(p.id), stackId: String(stack.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stateKeyParam).toBe('vm_name')
  })

  it('replaces steps for root user', async () => {
    const root = await createUser({ role: 'root' })
    const { p, stack } = await seedStack()
    const auth = await makeAuthHeader(root)
    const newSteps = [
      { template: 'vsphere/virtual-machine', stateSuffix: '-vsvm' },
      { template: 'linode/dns-record', stateSuffix: '-dns', upstreamSuffix: '-vsvm' },
    ]
    const res = await PUT(
      makeReq(String(p.id), String(stack.id), 'PUT', { steps: newSteps }, auth),
      { params: Promise.resolve({ id: String(p.id), stackId: String(stack.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.steps).toHaveLength(2)
    expect(body.steps[0].template).toBe('vsphere/virtual-machine')
    expect(body.steps[1].upstreamSuffix).toBe('-vsvm')
  })

  it('returns 400 for invalid webhook URL', async () => {
    const root = await createUser({ role: 'root' })
    const { p, stack } = await seedStack()
    const auth = await makeAuthHeader(root)
    const res = await PUT(
      makeReq(String(p.id), String(stack.id), 'PUT', { webhookUrl: 'not-a-url' }, auth),
      { params: Promise.resolve({ id: String(p.id), stackId: String(stack.id) }) },
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for empty steps array', async () => {
    const root = await createUser({ role: 'root' })
    const { p, stack } = await seedStack()
    const auth = await makeAuthHeader(root)
    const res = await PUT(
      makeReq(String(p.id), String(stack.id), 'PUT', { steps: [] }, auth),
      { params: Promise.resolve({ id: String(p.id), stackId: String(stack.id) }) },
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 for non-existent stack ID', async () => {
    const root = await createUser({ role: 'root' })
    const { p } = await seedStack()
    const auth = await makeAuthHeader(root)
    const res = await PUT(
      makeReq(String(p.id), '999999', 'PUT', { name: 'ghost' }, auth),
      { params: Promise.resolve({ id: String(p.id), stackId: '999999' }) },
    )
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/admin/products/[id]/pipeline-stacks/[stackId]', () => {
  it('returns 401 without auth token', async () => {
    const res = await DELETE(makeReq('1', '1', 'DELETE'), { params: Promise.resolve({ id: '1', stackId: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await DELETE(makeReq('1', '1', 'DELETE', undefined, auth), { params: Promise.resolve({ id: '1', stackId: '1' }) })
    expect(res.status).toBe(403)
  })

  it('deletes existing stack and returns 200 for root user', async () => {
    const root = await createUser({ role: 'root' })
    const { p, stack } = await seedStack()
    const auth = await makeAuthHeader(root)
    const res = await DELETE(
      makeReq(String(p.id), String(stack.id), 'DELETE', undefined, auth),
      { params: Promise.resolve({ id: String(p.id), stackId: String(stack.id) }) },
    )
    expect(res.status).toBe(200)
  })

  it('returns 404 for non-existent stack ID', async () => {
    const root = await createUser({ role: 'root' })
    const { p } = await seedStack()
    const auth = await makeAuthHeader(root)
    const res = await DELETE(
      makeReq(String(p.id), '999999', 'DELETE', undefined, auth),
      { params: Promise.resolve({ id: String(p.id), stackId: '999999' }) },
    )
    expect(res.status).toBe(404)
  })
})

describe('POST → PUT → DELETE progression', () => {
  it('create → update name + steps → delete, list reflects each change', async () => {
    const root = await createUser({ role: 'root' })
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const auth = await makeAuthHeader(root)
    const pid = String(p.id)

    // 1. Create via POST
    const postRes = await POST(
      new NextRequest(`http://localhost/api/admin/products/${pid}/pipeline-stacks`, {
        method: 'POST',
        body: JSON.stringify({
          environmentId: env.id,
          name: 'Initial Stack',
          webhookUrl: 'https://gitlab.example.com/trigger',
          webhookToken: 'tok',
          stateKeyParam: 'hostname',
          steps: [{ template: 'linode/virtual-machine', stateSuffix: '-vm' }],
        }),
        headers: { 'content-type': 'application/json', authorization: auth },
      }),
      { params: Promise.resolve({ id: pid }) },
    )
    expect(postRes.status).toBe(201)
    const created = await postRes.json()
    const stackId = String(created.id)

    // 2. Update name via PUT
    const putName = await PUT(
      makeReq(pid, stackId, 'PUT', { name: 'Renamed Stack' }, auth),
      { params: Promise.resolve({ id: pid, stackId }) },
    )
    expect(putName.status).toBe(200)
    expect((await putName.json()).name).toBe('Renamed Stack')

    // 3. Add a second step via PUT
    const putSteps = await PUT(
      makeReq(pid, stackId, 'PUT', {
        steps: [
          { template: 'linode/virtual-machine', stateSuffix: '-vm' },
          { template: 'linode/firewall', stateSuffix: '-fw', upstreamSuffix: '-vm' },
        ],
      }, auth),
      { params: Promise.resolve({ id: pid, stackId }) },
    )
    expect(putSteps.status).toBe(200)
    expect((await putSteps.json()).steps).toHaveLength(2)

    // 4. List still shows the stack with 2 steps
    const getRes = await GET(makeListReq(pid, auth), { params: Promise.resolve({ id: pid }) })
    const list = await getRes.json()
    const found = list.find((s: { id: number; name: string; steps: unknown[] }) => s.id === created.id)
    expect(found).toBeDefined()
    expect(found.name).toBe('Renamed Stack')
    expect(found.steps).toHaveLength(2)

    // 5. Delete via DELETE
    const delRes = await DELETE(
      makeReq(pid, stackId, 'DELETE', undefined, auth),
      { params: Promise.resolve({ id: pid, stackId }) },
    )
    expect(delRes.status).toBe(200)

    // 6. List no longer contains the stack
    const finalRes = await GET(makeListReq(pid, auth), { params: Promise.resolve({ id: pid }) })
    const finalList = await finalRes.json()
    expect(finalList.map((s: { id: number }) => s.id)).not.toContain(created.id)
  })
})
