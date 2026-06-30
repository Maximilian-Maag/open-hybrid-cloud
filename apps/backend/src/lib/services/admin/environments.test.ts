import { describe, it, expect } from 'vitest'
import {
  listEnvironments,
  createEnvironment,
  getEnvironmentById,
  updateEnvironment,
  deleteEnvironment,
} from './environments'
import { db } from '@/lib/db/client'
import { deploymentEnvironments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createCiSource } from '@/test/helpers'

describe('listEnvironments', () => {
  it('returns environments joined with ciSourceName', async () => {
    const ci = await createCiSource({ name: 'MyGitLab' })
    await createEnvironment({
      name: 'prod',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })

    const result = await listEnvironments()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].name).toBe('prod')
      expect(result.data[0].ciSourceName).toBe('MyGitLab')
    }
  })
})

describe('createEnvironment', () => {
  it('inserts an environment', async () => {
    const ci = await createCiSource()
    const result = await createEnvironment({
      name: 'dev',
      description: 'devvy',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('dev')
      expect(result.data.description).toBe('devvy')
    }
  })
})

describe('getEnvironmentById', () => {
  it('returns 404 for unknown id', async () => {
    const result = await getEnvironmentById(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns the environment when found', async () => {
    const ci = await createCiSource()
    const created = await createEnvironment({
      name: 'find',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })
    if (!created.ok) throw new Error('seed failed')

    const result = await getEnvironmentById(created.data.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('find')
  })
})

describe('updateEnvironment', () => {
  it('returns 404 for unknown id', async () => {
    const result = await updateEnvironment(999_999, { name: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('updates fields', async () => {
    const ci = await createCiSource()
    const created = await createEnvironment({
      name: 'old',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })
    if (!created.ok) throw new Error('seed failed')

    const result = await updateEnvironment(created.data.id, { name: 'new' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('new')
  })
})

describe('deleteEnvironment', () => {
  it('returns 404 for unknown id', async () => {
    const result = await deleteEnvironment(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('deletes from DB', async () => {
    const ci = await createCiSource()
    const created = await createEnvironment({
      name: 'del',
      ciSourceId: ci.id,
      webhookUrl: 'http://e',
      webhookToken: 'tok',
    })
    if (!created.ok) throw new Error('seed failed')

    const result = await deleteEnvironment(created.data.id)
    expect(result.ok).toBe(true)

    const rows = await db
      .select()
      .from(deploymentEnvironments)
      .where(eq(deploymentEnvironments.id, created.data.id))
    expect(rows.length).toBe(0)
  })
})
