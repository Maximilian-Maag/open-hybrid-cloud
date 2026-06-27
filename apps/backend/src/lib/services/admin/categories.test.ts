import { describe, it, expect } from 'vitest'
import {
  listCategories,
  createCategory,
  getCategoryById,
  updateCategory,
  deleteCategory,
} from './categories'
import { db } from '@/lib/db/client'
import { categories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

describe('listCategories', () => {
  it('returns empty when none exist', async () => {
    const result = await listCategories()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })

  it('returns categories ordered by displayOrder then name', async () => {
    await createCategory({ name: 'B', displayOrder: 1 })
    await createCategory({ name: 'A', displayOrder: 1 })
    await createCategory({ name: 'C', displayOrder: 0 })

    const result = await listCategories()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.map((c) => c.name)).toEqual(['C', 'A', 'B'])
    }
  })
})

describe('createCategory', () => {
  it('inserts a category', async () => {
    const result = await createCategory({ name: 'New', displayOrder: 5 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('New')
      expect(result.data.displayOrder).toBe(5)
    }
  })
})

describe('getCategoryById', () => {
  it('returns 404 for unknown id', async () => {
    const result = await getCategoryById(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns the category when found', async () => {
    const created = await createCategory({ name: 'Find' })
    if (!created.ok) throw new Error('seed failed')
    const result = await getCategoryById(created.data.id)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('Find')
  })
})

describe('updateCategory', () => {
  it('returns 404 for unknown id', async () => {
    const result = await updateCategory(999_999, { name: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('updates the name', async () => {
    const created = await createCategory({ name: 'Old' })
    if (!created.ok) throw new Error('seed failed')
    const result = await updateCategory(created.data.id, { name: 'Newer' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('Newer')
  })
})

describe('deleteCategory', () => {
  it('returns 404 for unknown id', async () => {
    const result = await deleteCategory(999_999)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('deletes the category from DB', async () => {
    const created = await createCategory({ name: 'Del' })
    if (!created.ok) throw new Error('seed failed')
    const result = await deleteCategory(created.data.id)
    expect(result.ok).toBe(true)

    const rows = await db.select().from(categories).where(eq(categories.id, created.data.id))
    expect(rows.length).toBe(0)
  })
})
