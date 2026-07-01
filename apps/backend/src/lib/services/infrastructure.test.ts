import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionUser } from '@open-hybrid-cloud/types'

vi.mock('@/lib/ci/webhooks', () => ({
  triggerProductWebhooks: vi.fn().mockResolvedValue(['pipe-destroy']),
}))

import { listInfrastructure, decommissionInfra } from './infrastructure'
import { triggerProductWebhooks } from '@/lib/ci/webhooks'
import { db } from '@/lib/db/client'
import { infrastructureElements } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import {
  createUser,
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
  createProject,
  createOrder as seedOrder,
  createInfraElement,
} from '@/test/helpers'

const makeSession = (u: { id: number; email: string; name: string; role: string }): SessionUser =>
  ({ id: u.id, email: u.email, name: u.name, role: u.role as SessionUser['role'] })

const mockedWebhooks = vi.mocked(triggerProductWebhooks)

beforeEach(() => {
  mockedWebhooks.mockReset().mockResolvedValue(['pipe-destroy'])
})

const setup = async () => {
  const admin = await createUser({ role: 'admin', email: 'admin@test.dev' })
  const pm = await createUser({ role: 'project_manager', email: 'pm@test.dev' })
  const otherPm = await createUser({ role: 'project_manager', email: 'other@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'P1')
  const product2 = await createProduct(cat.id, 'P2')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const project = await createProject(pm.id)
  const otherProject = await createProject(otherPm.id)
  return { admin, pm, otherPm, product, product2, env, project, otherProject }
}

describe('listInfrastructure', () => {
  it('admin sees infra from all projects', async () => {
    const { admin, pm, otherPm, product, env, project, otherProject } = await setup()
    const o1 = await seedOrder(project.id, product.id, env.id, pm.id)
    const o2 = await seedOrder(otherProject.id, product.id, env.id, otherPm.id)
    await createInfraElement(o1.id, project.id, env.id, product.id)
    await createInfraElement(o2.id, otherProject.id, env.id, product.id)

    const result = await listInfrastructure(makeSession(admin), {})
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.length).toBe(2)
  })

  it('PM only sees infra from their own projects', async () => {
    const { pm, otherPm, product, env, project, otherProject } = await setup()
    const o1 = await seedOrder(project.id, product.id, env.id, pm.id)
    const o2 = await seedOrder(otherProject.id, product.id, env.id, otherPm.id)
    await createInfraElement(o1.id, project.id, env.id, product.id)
    await createInfraElement(o2.id, otherProject.id, env.id, product.id)

    const result = await listInfrastructure(makeSession(pm), {})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].projectId).toBe(project.id)
    }
  })

  it('productId filter returns only matching elements', async () => {
    const { admin, pm, product, product2, env, project } = await setup()
    const o1 = await seedOrder(project.id, product.id, env.id, pm.id)
    const o2 = await seedOrder(project.id, product2.id, env.id, pm.id)
    await createInfraElement(o1.id, project.id, env.id, product.id)
    await createInfraElement(o2.id, project.id, env.id, product2.id)

    const result = await listInfrastructure(makeSession(admin), { productId: product.id })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].productId).toBe(product.id)
    }
  })

  it('projectId filter returns only matching elements', async () => {
    const { admin, pm, otherPm, product, env, project, otherProject } = await setup()
    const o1 = await seedOrder(project.id, product.id, env.id, pm.id)
    const o2 = await seedOrder(otherProject.id, product.id, env.id, otherPm.id)
    await createInfraElement(o1.id, project.id, env.id, product.id)
    await createInfraElement(o2.id, otherProject.id, env.id, product.id)

    const result = await listInfrastructure(makeSession(admin), { projectId: otherProject.id })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].projectId).toBe(otherProject.id)
    }
  })
})

describe('decommissionInfra', () => {
  it('returns 404 for unknown infra', async () => {
    const { admin } = await setup()
    const result = await decommissionInfra(makeSession(admin), 999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('PM gets 403 when decommissioning another user\'s project infra', async () => {
    const { otherPm, pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    const infra = await createInfraElement(order.id, project.id, env.id, product.id)

    const result = await decommissionInfra(makeSession(otherPm), infra.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('returns 400 when infra status is not active', async () => {
    const { admin, pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    const infra = await createInfraElement(order.id, project.id, env.id, product.id, {
      status: 'decommissioning',
    })

    const result = await decommissionInfra(makeSession(admin), infra.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('admin can decommission any active infra; updates status, triggers webhook with destroy/INFRA_ID', async () => {
    const { admin, pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    const infra = await createInfraElement(order.id, project.id, env.id, product.id)
    mockedWebhooks.mockResolvedValueOnce(['pipe-dc-1'])

    const result = await decommissionInfra(makeSession(admin), infra.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.pipelineIds).toEqual(['pipe-dc-1'])

    const [dbInfra] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, infra.id))
    expect(dbInfra.status).toBe('decommissioning')
    expect(dbInfra.pipelineId).toEqual(['pipe-dc-1'])

    expect(mockedWebhooks).toHaveBeenCalledTimes(1)
    const [pid, eid, vars] = mockedWebhooks.mock.calls[0]
    expect(pid).toBe(product.id)
    expect(eid).toBe(env.id)
    expect(vars).toMatchObject({ TF_ACTION: 'destroy', INFRA_ID: String(infra.id) })
  })

  it('PM can decommission their own project\'s active infra', async () => {
    const { pm, product, env, project } = await setup()
    const order = await seedOrder(project.id, product.id, env.id, pm.id)
    const infra = await createInfraElement(order.id, project.id, env.id, product.id)

    const result = await decommissionInfra(makeSession(pm), infra.id)
    expect(result.ok).toBe(true)

    const [dbInfra] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, infra.id))
    expect(dbInfra.status).toBe('decommissioning')
  })
})
