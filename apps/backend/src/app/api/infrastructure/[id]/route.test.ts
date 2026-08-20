import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { db } from '@/lib/db/client'
import { orders, parameters, infrastructureElements } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder,
  createInfraElement,
  createCostCenter,
  makeAuthHeader,
} from '@/test/helpers'

const makeReq = (id: string, auth?: string) =>
  new NextRequest(`http://localhost/api/infrastructure/${id}`, auth ? { headers: { authorization: auth } } : undefined)

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const scenario = async () => {
  const root = await createUser({ role: 'root', email: `detail-root-${Math.random()}@test.dev` })
  const pm = await createUser({ role: 'project_manager', email: `detail-pm-${Math.random()}@test.dev` })
  const other = await createUser({ role: 'project_manager', email: `detail-other-${Math.random()}@test.dev` })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Nginx Gateway')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id, undefined, 'AWS Frankfurt')
  const cc = await createCostCenter({ code: 'CC-7', name: 'Platform' })
  const project = await createProject(pm.id, 'Webshop Platform')
  const order = await createOrder(project.id, product.id, env.id, pm.id, { status: 'completed' })
  await db.update(orders).set({ costCenterId: cc.id }).where(eq(orders.id, order.id))
  const element = await createInfraElement(order.id, project.id, env.id, product.id, {
    parameters: { hostname: 'web-01', admin_password: 'sup3rs3cret' },
    pipelineId: ['pipe-1'],
    pipelineStatus: { 'pipe-1': 'success' },
    deployedAt: new Date('2026-03-01T10:00:00.000Z'),
  })
  await db
    .update(infrastructureElements)
    .set({ outputs: { ip_address: '203.0.113.10' } })
    .where(eq(infrastructureElements.id, element.id))
  return { root, pm, other, product, env, project, order, element, cc }
}

describe('GET /api/infrastructure/[id]', () => {
  it('returns 401 without a token', async () => {
    expect((await GET(makeReq('1'), params('1'))).status).toBe(401)
  })

  it('returns 400 for a non-numeric id', async () => {
    const { root } = await scenario()
    const res = await GET(makeReq('abc', await makeAuthHeader(root)), params('abc'))
    expect(res.status).toBe(400)
  })

  it('returns 404 for an element that does not exist', async () => {
    const { root } = await scenario()
    const res = await GET(makeReq('999999', await makeAuthHeader(root)), params('999999'))
    expect(res.status).toBe(404)
  })

  it('returns the element with everything the detail page renders', async () => {
    const { root, element } = await scenario()
    const res = await GET(makeReq(String(element.id), await makeAuthHeader(root)), params(String(element.id)))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toMatchObject({
      id: element.id,
      productName: 'Nginx Gateway',
      environmentName: 'AWS Frankfurt',
      projectName: 'Webshop Platform',
      status: 'active',
      orderStatus: 'completed',
      costCenter: 'CC-7 — Platform',
    })
    expect(body.outputs).toEqual({ ip_address: '203.0.113.10' })
    expect(body.pipelineId).toEqual(['pipe-1'])
    expect(body.pipelineStatus).toEqual({ 'pipe-1': 'success' })
    expect(body.deployedAt).toBeTruthy()
  })

  it('redacts the values of sensitive parameters, keeping their names', async () => {
    // The same rule the CSV export applies: a value hidden in one place and shown
    // in the other is worse than either choice made consistently.
    const { root, product, element } = await scenario()
    await db.insert(parameters).values({
      scope: 'product',
      scopeId: product.id,
      name: 'admin_password',
      type: 'string',
      sensitive: true,
    })

    const res = await GET(makeReq(String(element.id), await makeAuthHeader(root)), params(String(element.id)))
    const body = await res.json()

    expect(body.parameters.admin_password).toBe('[redacted]')
    expect(body.parameters.hostname).toBe('web-01')
    expect(body.redactedParameters).toEqual(['admin_password'])
  })

  it('lets the owning project manager see their own element', async () => {
    const { pm, element } = await scenario()
    const res = await GET(makeReq(String(element.id), await makeAuthHeader(pm)), params(String(element.id)))
    expect(res.status).toBe(200)
  })

  it("hides another project manager's element behind 404, not 403", async () => {
    // 403 would confirm the id exists, which is information about a project the
    // caller cannot see.
    const { other, element } = await scenario()
    const res = await GET(makeReq(String(element.id), await makeAuthHeader(other)), params(String(element.id)))
    expect(res.status).toBe(404)
  })

  it('reports a failed deployment as active-with-failed-order', async () => {
    // There is no `failed` element status: the element is created when
    // provisioning starts and stays active when the pipeline fails.
    const { root, order, element } = await scenario()
    await db.update(orders).set({ status: 'failed' }).where(eq(orders.id, order.id))

    const body = await (await GET(makeReq(String(element.id), await makeAuthHeader(root)), params(String(element.id)))).json()
    expect(body.status).toBe('active')
    expect(body.orderStatus).toBe('failed')
  })
})
