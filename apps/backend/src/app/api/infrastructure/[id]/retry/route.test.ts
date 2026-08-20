import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ci/webhooks', () => ({
  triggerProductWebhooks: vi.fn().mockResolvedValue([]),
  triggerPipelineStacks: vi.fn().mockResolvedValue([]),
  triggerProductWebhooksTracked: vi.fn().mockResolvedValue({ pipelineIds: ['new-pipe'], failures: [] }),
  triggerPipelineStacksTracked: vi.fn().mockResolvedValue({ pipelineIds: [], failures: [] }),
}))

import { NextRequest } from 'next/server'
import { POST } from './route'
import { triggerProductWebhooksTracked, triggerPipelineStacksTracked } from '@/lib/ci/webhooks'
import { db } from '@/lib/db/client'
import { orders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  makeAuthHeader,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder as seedOrder,
  createInfraElement,
} from '@/test/helpers'

const mockedWebhooks = vi.mocked(triggerProductWebhooksTracked)
const mockedStacks = vi.mocked(triggerPipelineStacksTracked)

beforeEach(() => {
  mockedWebhooks.mockReset().mockResolvedValue({ pipelineIds: ['new-pipe'], failures: [] })
  mockedStacks.mockReset().mockResolvedValue({ pipelineIds: [], failures: [] })
})

const makeReq = (auth?: string) =>
  new NextRequest('http://localhost/api/infrastructure/1/retry', {
    method: 'POST',
    ...(auth ? { headers: { authorization: auth } } : {}),
  })

const params = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) })

const setup = async () => {
  const root = await createUser({ role: 'root', email: 'retry-route-root@test.dev' })
  const admin = await createUser({ role: 'admin', email: 'retry-route-admin@test.dev' })
  const pm = await createUser({ role: 'project_manager', email: 'retry-route-pm@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'P')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const project = await createProject(pm.id)
  const order = await seedOrder(project.id, product.id, env.id, pm.id, { status: 'failed' })
  const el = await createInfraElement(order.id, project.id, env.id, product.id)
  return { root, admin, pm, order, el }
}

describe('POST /api/infrastructure/{id}/retry', () => {
  it('returns 401 without a token', async () => {
    const { el } = await setup()
    expect((await POST(makeReq(), params(el.id))).status).toBe(401)
  })

  it('returns 403 for a project manager', async () => {
    // Retrying re-fires CI pipelines against real infrastructure — heavier than
    // the decommission an orderer may perform on their own elements.
    const { pm, el } = await setup()
    const res = await POST(makeReq(await makeAuthHeader(pm)), params(el.id))
    expect(res.status).toBe(403)
  })

  it.each([['admin'], ['root']])('allows %s', async (role) => {
    const ctx = await setup()
    const user = role === 'admin' ? ctx.admin : ctx.root
    const res = await POST(makeReq(await makeAuthHeader(user)), params(ctx.el.id))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ pipelineIds: ['new-pipe'] })
    expect((await db.select().from(orders).where(eq(orders.id, ctx.order.id)))[0].status).toBe('provisioning')
  })

  it.each(['0', '-1', 'abc'])('rejects a malformed id (%s)', async (raw) => {
    const { admin } = await setup()
    const res = await POST(makeReq(await makeAuthHeader(admin)), params(raw))
    expect(res.status).toBe(400)
  })

  it('returns 404 for an unknown element', async () => {
    const { admin } = await setup()
    const res = await POST(makeReq(await makeAuthHeader(admin)), params(999_999))
    expect(res.status).toBe(404)
  })

  it('returns 400 when the deployment did not fail', async () => {
    const { admin, order, el } = await setup()
    await db.update(orders).set({ status: 'completed' }).where(eq(orders.id, order.id))

    const res = await POST(makeReq(await makeAuthHeader(admin)), params(el.id))
    expect(res.status).toBe(400)
  })

  it('surfaces a 502 when no pipeline could be started', async () => {
    const { admin, el } = await setup()
    mockedWebhooks.mockResolvedValue({ pipelineIds: [], failures: ['webhook "a" (#1): boom'] })

    const res = await POST(makeReq(await makeAuthHeader(admin)), params(el.id))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/could not start/i)
  })
})
