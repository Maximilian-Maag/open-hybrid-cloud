import { describe, it, expect } from 'vitest'
import { createCategory, createProduct, createCiSource, createEnvironment } from '@/test/helpers'
import { db } from '@/lib/db/client'
import { pipelineStacks } from '@/lib/db/schema'
import {
  listPipelineStacks,
  createPipelineStack,
  updatePipelineStack,
  deletePipelineStack,
} from './pipeline-stacks'

const STEPS = [
  { template: 'linode/virtual-machine', stateSuffix: '-vm' },
  { template: 'linode/firewall', stateSuffix: '-fw', upstreamSuffix: '-vm' },
]

const seedStack = async () => {
  const cat = await createCategory()
  const p = await createProduct(cat.id)
  const ci = await createCiSource()
  const env = await createEnvironment(ci.id)
  const [stack] = await db.insert(pipelineStacks).values({
    productId: p.id,
    environmentId: env.id,
    name: 'Seed Stack',
    webhookUrl: 'https://gitlab.example.com/trigger',
    webhookToken: 'secret',
    stateKeyParam: 'hostname',
    steps: STEPS,
  }).returning()
  return { p, env, stack }
}

describe('listPipelineStacks', () => {
  it('returns empty array for product with no stacks', async () => {
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const result = await listPipelineStacks(p.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })

  it('returns stacks belonging to the given product', async () => {
    const { p } = await seedStack()
    const result = await listPipelineStacks(p.id)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBeGreaterThanOrEqual(1)
      expect(result.data[0].name).toBe('Seed Stack')
      expect(result.data[0].steps).toHaveLength(2)
    }
  })

  it('does not return stacks belonging to a different product', async () => {
    const { stack } = await seedStack()
    const cat2 = await createCategory()
    const p2 = await createProduct(cat2.id)
    const result = await listPipelineStacks(p2.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.map((s) => s.id)).not.toContain(stack.id)
  })
})

describe('createPipelineStack', () => {
  it('creates a stack with all fields and returns it', async () => {
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const result = await createPipelineStack(p.id, {
      environmentId: env.id,
      name: 'VM Stack',
      webhookUrl: 'https://gitlab.example.com/trigger',
      webhookToken: 'tok',
      stateKeyParam: 'hostname',
      steps: STEPS,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('VM Stack')
      expect(result.data.productId).toBe(p.id)
      expect(result.data.environmentId).toBe(env.id)
      expect(result.data.stateKeyParam).toBe('hostname')
      expect(result.data.steps).toHaveLength(2)
      expect(result.data.steps[0].template).toBe('linode/virtual-machine')
      expect(result.data.steps[1].upstreamSuffix).toBe('-vm')
    }
  })

  it('defaults stateKeyParam to "hostname" when omitted', async () => {
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const result = await createPipelineStack(p.id, {
      environmentId: env.id,
      name: 'Stack',
      webhookUrl: 'https://gitlab.example.com/trigger',
      webhookToken: 'tok',
      steps: STEPS,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.stateKeyParam).toBe('hostname')
  })

  it('persists fixedParams inside steps', async () => {
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const stepsWithFixed = [
      { template: 'linode/virtual-machine', stateSuffix: '-vm', fixedParams: { LINODE_REGION: 'eu-central' } },
    ]
    const result = await createPipelineStack(p.id, {
      environmentId: env.id,
      name: 'Stack with fixed params',
      webhookUrl: 'https://gitlab.example.com/trigger',
      webhookToken: 'tok',
      steps: stepsWithFixed,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.steps[0].fixedParams?.LINODE_REGION).toBe('eu-central')
    }
  })
})

describe('updatePipelineStack', () => {
  it('updates name only, leaving other fields unchanged', async () => {
    const { p, stack } = await seedStack()
    const result = await updatePipelineStack(p.id, stack.id, { name: 'Renamed Stack' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('Renamed Stack')
      expect(result.data.stateKeyParam).toBe('hostname')
      expect(result.data.steps).toHaveLength(2)
    }
  })

  it('updates stateKeyParam', async () => {
    const { p, stack } = await seedStack()
    const result = await updatePipelineStack(p.id, stack.id, { stateKeyParam: 'vm_name' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.stateKeyParam).toBe('vm_name')
  })

  it('replaces steps entirely', async () => {
    const { p, stack } = await seedStack()
    const newSteps = [{ template: 'vsphere/virtual-machine', stateSuffix: '-vsvm' }]
    const result = await updatePipelineStack(p.id, stack.id, { steps: newSteps })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.steps).toHaveLength(1)
      expect(result.data.steps[0].template).toBe('vsphere/virtual-machine')
    }
  })

  it('returns 404 for non-existent stack ID', async () => {
    const { p } = await seedStack()
    const result = await updatePipelineStack(p.id, 999999, { name: 'ghost' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns 404 when stackId belongs to a different product', async () => {
    const { stack } = await seedStack()
    const cat2 = await createCategory()
    const p2 = await createProduct(cat2.id)
    const result = await updatePipelineStack(p2.id, stack.id, { name: 'hijack' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })
})

describe('deletePipelineStack', () => {
  it('deletes an existing stack successfully', async () => {
    const { p, stack } = await seedStack()
    const result = await deletePipelineStack(p.id, stack.id)
    expect(result.ok).toBe(true)
  })

  it('stack no longer appears in list after deletion', async () => {
    const { p, stack } = await seedStack()
    await deletePipelineStack(p.id, stack.id)
    const listed = await listPipelineStacks(p.id)
    if (listed.ok) expect(listed.data.map((s) => s.id)).not.toContain(stack.id)
  })

  it('returns 404 for non-existent stack ID', async () => {
    const { p } = await seedStack()
    const result = await deletePipelineStack(p.id, 999999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns 404 when stackId belongs to a different product', async () => {
    const { stack } = await seedStack()
    const cat2 = await createCategory()
    const p2 = await createProduct(cat2.id)
    const result = await deletePipelineStack(p2.id, stack.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })
})

describe('pipeline stack lifecycle progression', () => {
  it('create → list → update steps → update name → delete → list empty', async () => {
    const cat = await createCategory()
    const p = await createProduct(cat.id)
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)

    // 1. Create
    const created = await createPipelineStack(p.id, {
      environmentId: env.id,
      name: 'Lifecycle Stack',
      webhookUrl: 'https://gitlab.example.com/trigger',
      webhookToken: 'tok',
      stateKeyParam: 'hostname',
      steps: [{ template: 'linode/virtual-machine', stateSuffix: '-vm' }],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const id = created.data.id

    // 2. List — appears
    const listed = await listPipelineStacks(p.id)
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.data.map((s) => s.id)).toContain(id)

    // 3. Update steps — three-step chain
    const withThreeSteps = await updatePipelineStack(p.id, id, {
      steps: [
        { template: 'linode/virtual-machine', stateSuffix: '-vm' },
        { template: 'linode/firewall', stateSuffix: '-fw', upstreamSuffix: '-vm' },
        { template: 'linode/dns-record', stateSuffix: '-dns', upstreamSuffix: '-vm' },
      ],
    })
    expect(withThreeSteps.ok).toBe(true)
    if (withThreeSteps.ok) expect(withThreeSteps.data.steps).toHaveLength(3)

    // 4. Update name and stateKeyParam
    const renamed = await updatePipelineStack(p.id, id, { name: 'Full VM Stack', stateKeyParam: 'vm_name' })
    expect(renamed.ok).toBe(true)
    if (renamed.ok) {
      expect(renamed.data.name).toBe('Full VM Stack')
      expect(renamed.data.stateKeyParam).toBe('vm_name')
      expect(renamed.data.steps).toHaveLength(3)
    }

    // 5. Delete
    const del = await deletePipelineStack(p.id, id)
    expect(del.ok).toBe(true)

    // 6. List — gone
    const final = await listPipelineStacks(p.id)
    if (final.ok) expect(final.data.map((s) => s.id)).not.toContain(id)
  })
})
