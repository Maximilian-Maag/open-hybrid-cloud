import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ci', () => ({
  triggerPipeline: vi.fn(),
}))

import { triggerProductWebhooks } from './webhooks'
import { triggerPipeline } from './index'
import { db } from '@/lib/db/client'
import { productWebhooks } from '@/lib/db/schema'
import {
  createCategory,
  createProduct,
  createCiSource,
  createEnvironment,
} from '@/test/helpers'

const mockedTriggerPipeline = vi.mocked(triggerPipeline)

beforeEach(() => {
  mockedTriggerPipeline.mockReset()
  mockedTriggerPipeline.mockResolvedValue('pipe-default')
})

describe('triggerProductWebhooks', () => {
  it('returns an empty array when no webhooks are configured for the product/env', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    const result = await triggerProductWebhooks(product.id, env.id, { FOO: 'bar' })
    expect(result).toEqual([])
    expect(mockedTriggerPipeline).not.toHaveBeenCalled()
  })

  it('triggers one pipeline per webhook in exec order and returns IDs', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    // Insert two webhooks with explicit ordering
    await db.insert(productWebhooks).values([
      {
        productId: product.id,
        environmentId: env.id,
        name: 'second',
        webhookUrl: 'https://gl.example.com/api/v4/projects/2/trigger/pipeline',
        webhookToken: 'tok2',
        execOrder: 2,
      },
      {
        productId: product.id,
        environmentId: env.id,
        name: 'first',
        webhookUrl: 'https://gl.example.com/api/v4/projects/1/trigger/pipeline',
        webhookToken: 'tok1',
        execOrder: 1,
      },
    ])

    mockedTriggerPipeline
      .mockResolvedValueOnce('pipe-1')
      .mockResolvedValueOnce('pipe-2')

    const result = await triggerProductWebhooks(product.id, env.id, { ORDER_ID: '42' })

    expect(result).toEqual(['pipe-1', 'pipe-2'])
    expect(mockedTriggerPipeline).toHaveBeenCalledTimes(2)
    // First call should be the lower execOrder
    const firstCall = mockedTriggerPipeline.mock.calls[0]
    expect(firstCall[1]).toBe('https://gl.example.com/api/v4/projects/1/trigger/pipeline')
    expect(firstCall[2]).toBe('tok1')
    expect(firstCall[3]).toEqual({ ORDER_ID: '42' })
  })

  it('returns an empty array when the CI source is missing for the environment', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    // No env created at all — environmentId 999 won't resolve to a CI source
    const result = await triggerProductWebhooks(product.id, 999, { FOO: 'bar' })
    expect(result).toEqual([])
    expect(mockedTriggerPipeline).not.toHaveBeenCalled()
  })

  it('catches a pipeline trigger failure and continues with remaining webhooks', async () => {
    const cat = await createCategory()
    const product = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    await db.insert(productWebhooks).values([
      {
        productId: product.id,
        environmentId: env.id,
        name: 'will-fail',
        webhookUrl: 'https://gl.example.com/api/v4/projects/1/trigger/pipeline',
        webhookToken: 'tok-a',
        execOrder: 1,
      },
      {
        productId: product.id,
        environmentId: env.id,
        name: 'will-succeed',
        webhookUrl: 'https://gl.example.com/api/v4/projects/2/trigger/pipeline',
        webhookToken: 'tok-b',
        execOrder: 2,
      },
    ])

    mockedTriggerPipeline
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('pipe-ok')

    // Silence the expected console.error
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await triggerProductWebhooks(product.id, env.id, {})

    expect(result).toEqual(['pipe-ok'])
    expect(mockedTriggerPipeline).toHaveBeenCalledTimes(2)

    errSpy.mockRestore()
  })
})
