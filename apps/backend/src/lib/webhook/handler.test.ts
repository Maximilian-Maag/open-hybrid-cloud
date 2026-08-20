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
  linkProductEnvironment,
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

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-1', status: 'success' }, env.id)

    const [updated] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(updated.status).toBe('completed')
  })

  it('does not modify orders that do not match the pipeline ID', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, {
      status: 'provisioning',
      pipelineId: ['pipe-99'],
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-other', status: 'success' }, env.id)

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

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-dc-1', status: 'success' }, env.id)

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

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-fail', status: 'failed' }, env.id)

    const [updated] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(updated.status).toBe('failed')
  })

  it('transitions a provisioning order to failed on pipeline cancel', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, {
      status: 'provisioning',
      pipelineId: ['pipe-cancel'],
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-cancel', status: 'canceled' }, env.id)

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
    }, env.id)

    const [unchanged] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, el.id))
    expect(unchanged.status).toBe('decommissioning')
  })
})

describe('handlePipelineEvent — multi-pipeline orders', () => {
  it('stays provisioning after only the first of two pipelines succeeds', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, {
      status: 'provisioning',
      pipelineId: ['pipe-A', 'pipe-B'],
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-A', status: 'success' }, env.id)

    const [afterA] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(afterA.status).toBe('provisioning')
    expect(afterA.pipelineStatus).toEqual({ 'pipe-A': 'success' })
  })

  it('becomes completed only after ALL pipelines have succeeded', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, {
      status: 'provisioning',
      pipelineId: ['pipe-A', 'pipe-B'],
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-A', status: 'success' }, env.id)
    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-B', status: 'success' }, env.id)

    const [done] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(done.status).toBe('completed')
    expect(done.pipelineStatus).toEqual({ 'pipe-A': 'success', 'pipe-B': 'success' })
  })

  it('becomes failed if any sibling pipeline fails after another succeeded', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, {
      status: 'provisioning',
      pipelineId: ['pipe-A', 'pipe-B'],
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-A', status: 'success' }, env.id)
    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-B', status: 'failed' }, env.id)

    const [failed] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(failed.status).toBe('failed')
    expect(failed.pipelineStatus).toMatchObject({ 'pipe-A': 'success', 'pipe-B': 'failed' })
  })

  it('a stale success after a terminal failure does not resurrect the order', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, {
      status: 'provisioning',
      pipelineId: ['pipe-A', 'pipe-B'],
    })

    // B fails first → order is terminally failed.
    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-B', status: 'failed' }, env.id)
    // A late/duplicate success for the sibling must NOT flip it back to completed
    // (the transition is guarded on the order still being 'provisioning').
    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-A', status: 'success' }, env.id)

    const [after] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(after.status).toBe('failed')
  })

  it('does not complete an order that carries a trigger-failed sentinel', async () => {
    // A trigger that never started contributes no pipeline id but does leave a
    // `trigger-failed:*` entry (see retryProvisioning). Checking only the
    // pipeline ids would complete the order as soon as the pipelines that DID
    // start succeed — reporting a fully provisioned order while one webhook or
    // stack was never fired at all.
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, {
      status: 'provisioning',
      pipelineId: ['pipe-A'],
    })
    await db
      .update(orders)
      .set({ pipelineStatus: { 'trigger-failed:0': 'product webhook "b" (#2): boom' } })
      .where(eq(orders.id, order.id))

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-A', status: 'success' }, env.id)

    const [after] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(after.status).toBe('provisioning')
    expect(after.pipelineStatus).toMatchObject({
      'pipe-A': 'success',
      'trigger-failed:0': 'product webhook "b" (#2): boom',
    })
  })
})

describe('handlePipelineEvent — environment scoping', () => {
  it('does not transition an order that belongs to a different environment', async () => {
    const { user, product, env, project } = await buildScenario()
    // A second environment whose callback secret is what authenticated the event.
    const ci2 = await createCiSource({ name: 'CI-2' })
    const envB = await createEnvironment(ci2.id, 'wh-secret-b')
    await linkProductEnvironment(product.id, envB.id)

    // Order lives in env A, but the event is scoped to env B's id.
    const order = await createOrder(project.id, product.id, env.id, user.id, {
      status: 'provisioning',
      pipelineId: ['pipe-shared'],
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-shared', status: 'success' }, envB.id)

    const [unchanged] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(unchanged.status).toBe('provisioning')

    // Same event scoped to the order's own environment DOES transition it.
    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-shared', status: 'success' }, env.id)
    const [completed] = await db.select().from(orders).where(eq(orders.id, order.id))
    expect(completed.status).toBe('completed')
  })

  it('does not transition a decommissioning infra element from another environment', async () => {
    const { user, product, env, project } = await buildScenario()
    const ci2 = await createCiSource({ name: 'CI-2' })
    const envB = await createEnvironment(ci2.id, 'wh-secret-b')

    const order = await createOrder(project.id, product.id, env.id, user.id, { status: 'completed' })
    const el = await createInfraElement(order.id, project.id, env.id, product.id, {
      status: 'decommissioning',
      pipelineId: ['pipe-dc-shared'],
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-dc-shared', status: 'success' }, envB.id)

    const [unchanged] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, el.id))
    expect(unchanged.status).toBe('decommissioning')
  })
})

describe('handlePipelineEvent — infra decommission completion', () => {
  it('waits for EVERY destroy pipeline before marking the element decommissioned', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, { status: 'completed' })
    // Teardown fanned out to a product webhook AND a pipeline stack.
    const el = await createInfraElement(order.id, project.id, env.id, product.id, {
      status: 'decommissioning',
      pipelineId: ['pipe-wh', 'pipe-stack'],
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-wh', status: 'success' }, env.id)

    const [partial] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, el.id))
    // One of two done — the stack is still running, so the teardown is NOT complete.
    expect(partial.status).toBe('decommissioning')
    expect(partial.pipelineStatus).toEqual({ 'pipe-wh': 'success' })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-stack', status: 'success' }, env.id)

    const [complete] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, el.id))
    expect(complete.status).toBe('decommissioned')
    expect(complete.pipelineStatus).toEqual({ 'pipe-wh': 'success', 'pipe-stack': 'success' })
  })

  it('a failed destroy pipeline keeps a later sibling success from reporting completion', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, { status: 'completed' })
    const el = await createInfraElement(order.id, project.id, env.id, product.id, {
      status: 'decommissioning',
      pipelineId: ['pipe-wh', 'pipe-stack'],
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-stack', status: 'failed' }, env.id)
    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-wh', status: 'success' }, env.id)

    const [row] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, el.id))
    // One stack was never destroyed — reporting 'decommissioned' here would
    // hide leaked infrastructure.
    expect(row.status).toBe('decommissioning')
    expect(row.pipelineStatus).toEqual({ 'pipe-stack': 'failed', 'pipe-wh': 'success' })
  })

  it('a trigger-failed sentinel blocks completion even when every started pipeline succeeds', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, { status: 'completed' })
    // A destroy trigger that never started contributes no pipeline id, only the
    // sentinel written by fireDestroyTriggers.
    const el = await createInfraElement(order.id, project.id, env.id, product.id, {
      status: 'decommissioning',
      pipelineId: ['pipe-wh'],
      pipelineStatus: { 'trigger-failed:0': 'pipeline stack "stack-1" (#1): boom' },
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-wh', status: 'success' }, env.id)

    const [row] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, el.id))
    expect(row.status).toBe('decommissioning')
  })

  it('a stale duplicate success does not re-run the terminal transition', async () => {
    const { user, product, env, project } = await buildScenario()
    const order = await createOrder(project.id, product.id, env.id, user.id, { status: 'completed' })
    const el = await createInfraElement(order.id, project.id, env.id, product.id, {
      status: 'decommissioning',
      pipelineId: ['pipe-only'],
    })

    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-only', status: 'success' }, env.id)
    await handlePipelineEvent({ provider: 'gitlab', pipelineId: 'pipe-only', status: 'success' }, env.id)

    const [row] = await db
      .select()
      .from(infrastructureElements)
      .where(eq(infrastructureElements.id, el.id))
    expect(row.status).toBe('decommissioned')
  })
})

describe('handlePipelineEvent — no-ops', () => {
  it('does nothing when no matching order exists', async () => {
    await expect(
      handlePipelineEvent({ provider: 'gitlab', pipelineId: 'nonexistent', status: 'success' }, 999_999),
    ).resolves.toBeUndefined()
  })
})
