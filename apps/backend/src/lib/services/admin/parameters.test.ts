import { describe, it, expect } from 'vitest'
import {
  listParameters,
  createParameter,
  updateParameter,
  deleteParameter,
} from './parameters'
import { db } from '@/lib/db/client'
import { parameters } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

describe('listParameters', () => {
  it('returns all when no filter', async () => {
    await createParameter({ scope: 'global', name: 'G1', type: 'string' })
    await createParameter({ scope: 'product', scopeId: 1, name: 'P1', type: 'string' })

    const result = await listParameters({})
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.length).toBe(2)
  })

  it('filters by scope=product', async () => {
    await createParameter({ scope: 'global', name: 'G1', type: 'string' })
    await createParameter({ scope: 'product', scopeId: 1, name: 'P1', type: 'string' })
    await createParameter({ scope: 'category', scopeId: 1, name: 'C1', type: 'string' })

    const result = await listParameters({ scope: 'product' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].scope).toBe('product')
    }
  })

  it('filters by scopeId', async () => {
    await createParameter({ scope: 'product', scopeId: 10, name: 'A', type: 'string' })
    await createParameter({ scope: 'product', scopeId: 20, name: 'B', type: 'string' })

    const result = await listParameters({ scope: 'product', scopeId: 10 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].name).toBe('A')
    }
  })
})

describe('createParameter', () => {
  it('inserts a parameter with all defaults', async () => {
    const result = await createParameter({ scope: 'global', name: 'X', type: 'string' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.scope).toBe('global')
      expect(result.data.scopeId).toBe(0)
      expect(result.data.required).toBe(false)
      expect(result.data.sensitive).toBe(false)
    }
  })

  it('stores label when provided', async () => {
    const result = await createParameter({ scope: 'global', name: 'region', label: 'Region', type: 'string' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.label).toBe('Region')
  })

  it('stores empty label by default', async () => {
    const result = await createParameter({ scope: 'global', name: 'region', type: 'string' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.label).toBe('')
  })
})

describe('updateParameter', () => {
  it('returns 404 for unknown id', async () => {
    const result = await updateParameter(999_999, { name: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('updates fields', async () => {
    const created = await createParameter({ scope: 'global', name: 'old', type: 'string' })
    if (!created.ok) throw new Error('seed failed')
    const result = await updateParameter(created.data.id, { name: 'new', required: true })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('new')
      expect(result.data.required).toBe(true)
    }
  })

  it('updates label field', async () => {
    const created = await createParameter({ scope: 'global', name: 'x', type: 'string', label: 'Old Label' })
    if (!created.ok) throw new Error('seed failed')
    const result = await updateParameter(created.data.id, { label: 'New Label' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.label).toBe('New Label')
  })
})

describe('deleteParameter', () => {
  it('returns 404 for unknown id', async () => {
    const result = await deleteParameter(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('removes from DB', async () => {
    const created = await createParameter({ scope: 'global', name: 'del', type: 'string' })
    if (!created.ok) throw new Error('seed failed')
    const result = await deleteParameter(created.data.id)
    expect(result.ok).toBe(true)

    const rows = await db.select().from(parameters).where(eq(parameters.id, created.data.id))
    expect(rows.length).toBe(0)
  })
})
