import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The whole CI surface `refreshElementOutputs` reaches for. This file is about
// the route — the role check, the id parsing, the scoping — so the traces come
// back empty and the service's own behaviour is left to refreshOutputs.test.ts.
vi.mock('@/lib/ci', () => ({
  fetchJobTraces: vi.fn().mockResolvedValue([]),
  parseTofuOutputs: () => ({}),
  supportsJobTrace: () => true,
}))

import { POST } from './route'
import {
  createUser, createCategory, createProduct, createCiSource, createEnvironment,
  linkProductEnvironment, createProject, createOrder, createInfraElement, makeAuthHeader,
} from '@/test/helpers'
import { refreshOutputsLimit } from '@/lib/services/infrastructure'

/**
 * The HTTP surface of the outputs refresh (#181, #218).
 *
 * `requireAuth` and not `requireRole('admin')` like the sibling retry endpoint,
 * because the two do different things: retry re-fires CI against real
 * infrastructure, this re-reads a text file. The service scopes it to elements
 * the caller may read and answers 404 for the rest — which is what makes the
 * looser role check safe, and therefore what has to be tested.
 */

const makeReq = (id: string, auth?: string) =>
  new NextRequest(`http://localhost/api/infrastructure/${id}/outputs`, {
    method: 'POST',
    headers: { ...(auth ? { authorization: auth } : {}) },
  })

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  // Module-level and one-per-cooldown, so one case would throttle the next.
  refreshOutputsLimit.clear()
})

async function element(ownerRole: 'project_manager' | 'admin' = 'project_manager') {
  const owner = await createUser({ role: ownerRole })
  const cat = await createCategory()
  const product = await createProduct(cat.id)
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  await linkProductEnvironment(product.id, env.id)
  const project = await createProject(owner.id)
  const order = await createOrder(project.id, product.id, env.id, owner.id, { status: 'completed' })
  const infra = await createInfraElement(order.id, product.id, env.id, project.id)
  return { owner, infra, auth: await makeAuthHeader(owner) }
}

describe('POST /api/infrastructure/[id]/outputs', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await POST(makeReq('1'), ctx('1'))).status).toBe(401)
  })

  it('answers for the owner of the element', async () => {
    const { infra, auth } = await element()
    const res = await POST(makeReq(String(infra.id), auth), ctx(String(infra.id)))
    // 200 or a service-level refusal — never 401/403, which is the point of
    // requireAuth here.
    expect([200, 404, 409, 429, 502]).toContain(res.status)
    expect(res.status).not.toBe(403)
  })

  /*
   * The looser role check leans entirely on the service scoping reads. A project
   * manager who does not own the project must not see another one's outputs, and
   * the answer is 404 rather than 403 — the same answer the detail endpoint
   * gives, so the two cannot be told apart by probing.
   */
  it('answers 404 for an element belonging to somebody else', async () => {
    const { infra } = await element()
    const stranger = await createUser({ role: 'project_manager' })

    const res = await POST(makeReq(String(infra.id), await makeAuthHeader(stranger)), ctx(String(infra.id)))

    expect(res.status).toBe(404)
  })

  it('answers 404 for an element that is not there', async () => {
    const { auth } = await element()
    expect((await POST(makeReq('999999', auth), ctx('999999'))).status).toBe(404)
  })

  // `Number('0x10')` is 16, `Number(' 5 ')` is 5 — parseRouteId is digits-only.
  it.each(['0x10', ' 5 ', 'abc', '-1'])('refuses the malformed id %s with 400', async (id) => {
    const { auth } = await element()
    expect((await POST(makeReq(id, auth), ctx(id))).status).toBe(400)
  })
})
