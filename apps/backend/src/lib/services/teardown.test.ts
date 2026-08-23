import { describe, it, expect, vi, beforeEach } from 'vitest'

// Only the outbound HTTP call is mocked. `lib/ci/webhooks` runs for real, because
// what these tests are about is the state key it DERIVES — a teardown that
// derives a different one than its provisioning did destroys nothing while
// reporting success.
vi.mock('@/lib/ci', () => ({
  triggerPipeline: vi.fn(),
}))

import { destroyVariables, fireDestroyTriggers } from './teardown'
import { triggerPipeline } from '@/lib/ci'
import { db } from '@/lib/db/client'
import { pipelineStacks } from '@/lib/db/schema'
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

const mockedTriggerPipeline = vi.mocked(triggerPipeline)

beforeEach(() => {
  mockedTriggerPipeline.mockReset()
  mockedTriggerPipeline.mockResolvedValue('pipe-destroy')
})

const stateNameOf = () =>
  (mockedTriggerPipeline.mock.calls[0][3] as Record<string, string>).TF_STATE_NAME

const seed = async (overrides?: { parameters?: Record<string, string>; stateKeyNamespace?: string | null }) => {
  const user = await createUser({ role: 'admin' })
  const cat = await createCategory()
  const product = await createProduct(cat.id)
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const project = await createProject(user.id)
  const order = await createOrder(project.id, product.id, env.id, user.id)
  await db.insert(pipelineStacks).values({
    productId: product.id,
    environmentId: env.id,
    name: 'stack',
    stateKeyParam: 'hostname',
    steps: [{ template: 'vm', suffix: 'vm' }] as never,
  })
  const element = await createInfraElement(order.id, project.id, env.id, product.id, {
    parameters: overrides?.parameters ?? { hostname: 'web-01' },
    ...(overrides?.stateKeyNamespace !== undefined
      ? { stateKeyNamespace: overrides.stateKeyNamespace }
      : {}),
  })
  return { element, order }
}

describe('destroyVariables', () => {
  it('destroys the state an element provisioned before #183 actually created', async () => {
    // The helper leaves state_key_namespace NULL, which is what every row written
    // before the column existed has. Its Terraform state lives under the raw
    // hostname, so namespacing the teardown key would aim the destroy at a state
    // that was never created and leave the real infrastructure running.
    const { element } = await seed()

    await fireDestroyTriggers(element, destroyVariables(element))

    expect(stateNameOf()).toBe('web-01')
  })

  it('destroys the namespaced state of an element provisioned after it', async () => {
    // Read off the row rather than recomputed, so the answer cannot change under
    // an element that is already running.
    const { element } = await seed({ stateKeyNamespace: '77' })

    await fireDestroyTriggers(element, destroyVariables(element))

    expect(stateNameOf()).toBe('web-01-77')
  })

  it('does not let a stored parameter choose the git ref the destroy runs from', async () => {
    // A parameter definition named REF was creatable until #183, and every order
    // placed against one persisted its value onto the element. Rejecting new
    // definitions does nothing for this row; the filter is what does.
    const { element } = await seed({ parameters: { hostname: 'web-01', REF: 'attacker/branch' } })

    const variables = destroyVariables(element)

    expect(variables.REF).toBeUndefined()
    expect(variables.TF_ACTION).toBe('destroy')
    expect(variables.hostname).toBe('web-01')
  })
})
