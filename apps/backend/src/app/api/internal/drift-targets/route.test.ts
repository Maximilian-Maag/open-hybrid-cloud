import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { db } from '@/lib/db/client'
import { pipelineStacks } from '@/lib/db/schema'
import {
  createUser, createCategory, createProduct, createCiSource,
  createEnvironment, createProject, createOrder, createInfraElement,
} from '@/test/helpers'

/**
 * The work list the drift pipeline asks for (#108).
 *
 * This response carries the variables each element was provisioned with, so the
 * guard on it is the point of the file. CI already receives exactly these at
 * provisioning — this is not a new class of exposure — but it is the whole
 * estate in one response, so an unconfigured or unauthenticated caller must get
 * nothing at all.
 */
const SECRET = 'drift-secret-value'

beforeEach(() => { process.env.DRIFT_REPORT_SECRET = SECRET })
afterEach(() => { delete process.env.DRIFT_REPORT_SECRET })

const get = (secret?: string) =>
  new NextRequest('http://localhost/api/internal/drift-targets', {
    method: 'GET',
    ...(secret === undefined ? {} : { headers: { 'x-drift-secret': secret } }),
  })

describe('GET /api/internal/drift-targets', () => {
  it('is disabled with a 503 when the secret is unset', async () => {
    delete process.env.DRIFT_REPORT_SECRET
    const res = await GET(get('anything'))
    expect(res.status).toBe(503)
  })

  it.each([
    ['no secret', undefined],
    ['the wrong secret', 'nope'],
    ['a prefix of the secret', SECRET.slice(0, 6)],
  ])('refuses %s with a 401, and returns no variables', async (_name, secret) => {
    const res = await GET(get(secret))
    expect(res.status).toBe(401)
    expect(JSON.stringify(await res.json())).not.toContain('targets')
  })

  it('returns the state name, the steps and the variables for an active element', async () => {
    const user = await createUser({ email: 'targets-route@test.dev' })
    const category = await createCategory()
    const product = await createProduct(category.id)
    const ci = await createCiSource()
    const environment = await createEnvironment(ci.id)
    const project = await createProject(user.id)
    const [stack] = await db.insert(pipelineStacks).values({
      productId: product.id,
      environmentId: environment.id,
      name: 'vm',
      stateKeyParam: 'hostname',
      steps: [{ template: 'linode/virtual-machine', stateSuffix: 'vm', execOrder: 0, upstreamRefs: [] }],
    }).returning()
    const order = await createOrder(project.id, product.id, environment.id, user.id, { status: 'completed' })
    await createInfraElement(order.id, project.id, environment.id, product.id, {
      status: 'active',
      parameters: { hostname: 'web-01' },
      stateKeys: { [String(stack.id)]: 'web-01-o42' },
    })

    const res = await GET(get(SECRET))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.targets).toHaveLength(1)
    expect(body.targets[0].stateName).toBe('web-01-o42')
    expect(body.targets[0].stack[0].stateSuffix).toBe('vm')
  })

  it('returns an empty list rather than an error when there is nothing to check', async () => {
    const res = await GET(get(SECRET))
    expect(res.status).toBe(200)
    expect((await res.json()).targets).toEqual([])
  })
})
