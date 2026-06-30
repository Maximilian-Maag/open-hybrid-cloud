import { describe, it, expect, vi } from 'vitest'
import { handlePipelineEvent } from './handler'
import { db } from '@/lib/db/client'
import { orders, infrastructureElements } from '@/lib/db/schema'
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
} from '@/test/helpers'

// Prevent real HTTP calls and email sending during tests
vi.mock('@/lib/ci', () => ({
  fetchJobTrace: vi.fn().mockResolvedValue(''),
  parseTofuOutputs: vi.fn().mockReturnValue({}),
  triggerPipeline: vi.fn(),
}))

vi.mock('@/lib/notification/index', () => ({
  sendProvisioningCompleted: vi.fn().mockResolvedValue(undefined),
  sendProvisioningFailed: vi.fn().mockResolvedValue(undefined),
  sendDecommissioned: vi.fn().mockResolvedValue(undefined),
  sendOrderCreated: vi.fn().mockResolvedValue(undefined),
  sendOrderApproved: vi.fn().mockResolvedValue(undefined),
  sendOrderRejected: vi.fn().mockResolvedValue(undefined),
}))

// Helpers to build a minimal full scenario
const buildScenario = async () => {
  const user = await createUser({ email: 'wh@test.dev' })
  const cat = await createCategory()
  const product = await createProduct(cat.id, 'Infra Product')
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const project = await createProject(user.id)
  return { user, product, env, project }
}

describe('handlePipelineEvent — success', () => {
  it('transitions a provisioning order to completed', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, {
      status: 'provisioning',
      pipelineId: ['pipe-1'],
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-1', status: 'success' })

    const [updated] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(updated.status).toBe('completed')
  })

  it('does not modify orders that do not match the pipeline ID', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, {
      status: 'provisioning',
      pipelineId: ['pipe-99'],
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-other', status: 'success' })

    const [unchanged] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(unchanged.status).toBe('provisioning')
  })

  it('transitions a decommissioning infra element to decommissioned', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, {
      status: 'completed',
    })
    const el = await createInfraElement(order.id, project.id, env.id, product.id, {
      status: 'decommissioning',
      pipelineId: ['pipe-dc-1'],
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-dc-1', status: 'success' })

    const [updated] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, el.id))
    expect(updated.status).toBe('decommissioned')
  })
})

describe('handlePipelineEvent — failure', () => {
  it('transitions a provisioning order to failed on pipeline failure', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, {
      status: 'provisioning',
      pipelineId: ['pipe-fail'],
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-fail', status: 'failed' })

    const [updated] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(updated.status).toBe('failed')
  })

  it('transitions a provisioning order to failed on pipeline cancel', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, {
      status: 'provisioning',
      pipelineId: ['pipe-cancel'],
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-cancel', status: 'canceled' })

    const [updated] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(updated.status).toBe('failed')
  })

  it('leaves decommissioning infra status unchanged on failure', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id)
    const el = await createInfraElement(order.id, project.id, env.id, product.id, {
      status: 'decommissioning',
      pipelineId: ['pipe-dc-fail'],
    })

    await handlePipelineEvent({
      provider: 'gitlab',
      pipelineId: 'pipe-dc-fail',
      status: 'failed',
    })

    const [unchanged] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, el.id))
    expect(unchanged.status).toBe('decommissioning')
  })
})

describe('handlePipelineEvent — no-ops', () => {
  it('does nothing when no matching order exists', async () => {
    await expect(
      handlePipelineEvent({ provider: 'gitlab', pipelineId: 'nonexistent', status: 'success' }),
    ).resolves.toBeUndefined()
  })
})
