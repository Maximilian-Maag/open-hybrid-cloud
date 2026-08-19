import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { db } from '@/lib/db/client'
import { infrastructureElements } from '@/lib/db/schema'
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

const makeReq = (body: unknown, auth?: string) =>
  new NextRequest('http://localhost/api/infrastructure/1/schedule-decommission', {
    method: 'POST',
    body: JSON.stringify(body),
    ...(auth ? { headers: { authorization: auth, 'content-type': 'application/json' } } : {}),
  })

const params = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) })

const setup = async () => {
  const admin = await createUser({ role: 'admin', email: 'sched-route-admin@test.dev' })
  const pm = await createUser({ role: 'project_manager', email: 'sched-route-pm@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'P')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const project = await createProject(pm.id)
  const order = await seedOrder(project.id, product.id, env.id, pm.id)
  const el = await createInfraElement(order.id, project.id, env.id, product.id)
  return { admin, pm, el, auth: await makeAuthHeader(admin) }
}

const future = () => new Date(Date.now() + 3_600_000).toISOString()

const stored = async (id: number) =>
  (await db.select().from(infrastructureElements).where(eq(infrastructureElements.id, id)))[0]

describe('POST /api/infrastructure/{id}/schedule-decommission', () => {
  it('returns 401 without a token', async () => {
    const { el } = await setup()
    expect((await POST(makeReq({ scheduledAt: future() }), params(el.id))).status).toBe(401)
  })

  it('stores a future timestamp', async () => {
    const { el, auth } = await setup()
    const at = future()
    const res = await POST(makeReq({ scheduledAt: at }, auth), params(el.id))
    expect(res.status).toBe(200)
    expect((await stored(el.id)).scheduledDecommissionAt?.toISOString()).toBe(at)
  })

  it('clears the schedule on an explicit null', async () => {
    const { el, auth } = await setup()
    await POST(makeReq({ scheduledAt: future() }, auth), params(el.id))
    const res = await POST(makeReq({ scheduledAt: null }, auth), params(el.id))
    expect(res.status).toBe(200)
    expect((await stored(el.id)).scheduledDecommissionAt).toBeNull()
  })

  it('rejects an omitted scheduledAt rather than treating it as a clear', async () => {
    // An omitted field is indistinguishable from a malformed body, and guessing
    // would mean silently cancelling a schedule.
    const { el, auth } = await setup()
    const res = await POST(makeReq({}, auth), params(el.id))
    expect(res.status).toBe(400)
  })

  it.each(['not-a-date', '2026-06-01', 1234, true])('rejects a malformed scheduledAt (%s)', async (value) => {
    const { el, auth } = await setup()
    const res = await POST(makeReq({ scheduledAt: value }, auth), params(el.id))
    expect(res.status).toBe(400)
  })

  it('rejects a past timestamp', async () => {
    const { el, auth } = await setup()
    const res = await POST(makeReq({ scheduledAt: new Date(Date.now() - 60_000).toISOString() }, auth), params(el.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/future/i)
  })

  it.each(['0', 'abc'])('rejects a malformed infrastructure id (%s)', async (raw) => {
    const { auth } = await setup()
    const res = await POST(makeReq({ scheduledAt: future() }, auth), params(raw))
    expect(res.status).toBe(400)
  })

  it('returns 404 for an unknown element', async () => {
    const { auth } = await setup()
    const res = await POST(makeReq({ scheduledAt: future() }, auth), params(999_999))
    expect(res.status).toBe(404)
  })

  it('lets the owning project manager schedule their own element', async () => {
    const { pm, el } = await setup()
    const res = await POST(makeReq({ scheduledAt: future() }, await makeAuthHeader(pm)), params(el.id))
    expect(res.status).toBe(200)
  })

  it('forbids a project manager who does not own the project', async () => {
    const { el } = await setup()
    const outsider = await createUser({ role: 'project_manager', email: 'sched-route-out@test.dev' })
    const res = await POST(makeReq({ scheduledAt: future() }, await makeAuthHeader(outsider)), params(el.id))
    expect(res.status).toBe(403)
  })
})
