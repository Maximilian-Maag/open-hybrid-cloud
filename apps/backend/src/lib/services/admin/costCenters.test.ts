import { describe, it, expect } from 'vitest'
import {
  listCostCenters,
  createCostCenter,
  getCostCenterById,
  updateCostCenter,
  deleteCostCenter,
} from './costCenters'
import { db } from '@/lib/db/client'
import { costCenters } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

describe('listCostCenters', () => {
  it('returns empty when none', async () => {
    const result = await listCostCenters()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })

  it('returns cost centers ordered by code', async () => {
    await createCostCenter({ code: 'B', name: 'Beta' })
    await createCostCenter({ code: 'A', name: 'Alpha' })

    const result = await listCostCenters()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.map((c) => c.code)).toEqual(['A', 'B'])
    }
  })
})

describe('createCostCenter', () => {
  it('inserts with active=true default', async () => {
    const result = await createCostCenter({ code: 'CC1', name: 'CC One' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.code).toBe('CC1')
      expect(result.data.active).toBe(true)
    }
  })
})

describe('getCostCenterById', () => {
  it('returns 404 for unknown id', async () => {
    const result = await getCostCenterById(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns the cost center when found', async () => {
    const created = await createCostCenter({ code: 'X', name: 'X-Name' })
    if (!created.ok) throw new Error('seed failed')

    const result = await getCostCenterById(created.data.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('X-Name')
  })
})

describe('updateCostCenter', () => {
  it('returns 404 for unknown id', async () => {
    const result = await updateCostCenter(999_999, { name: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('updates fields', async () => {
    const created = await createCostCenter({ code: 'X', name: 'Old' })
    if (!created.ok) throw new Error('seed failed')

    const result = await updateCostCenter(created.data.id, { name: 'New', active: false })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('New')
      expect(result.data.active).toBe(false)
    }
  })
})

describe('deleteCostCenter', () => {
  it('returns 404 for unknown id', async () => {
    const result = await deleteCostCenter(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('deletes from DB', async () => {
    const created = await createCostCenter({ code: 'D', name: 'Del' })
    if (!created.ok) throw new Error('seed failed')

    const result = await deleteCostCenter(created.data.id)
    expect(result.ok).toBe(true)

    const rows = await db.select().from(costCenters).where(eq(costCenters.id, created.data.id))
    expect(rows.length).toBe(0)
  })
})
