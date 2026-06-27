import { db } from '@/lib/db/client'
import { categories, products, infrastructureElements, type Category } from '@/lib/db/schema'
import { eq, asc, and } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'
import { triggerProductWebhooks } from '@/lib/ci/webhooks'

export interface CreateCategoryInput {
  name: string
  displayOrder?: number
}

export interface UpdateCategoryInput {
  name?: string
  displayOrder?: number
}

export const listCategories = async (): Promise<Result<Category[]>> => {
  const rows = await db
    .select()
    .from(categories)
    .orderBy(asc(categories.displayOrder), asc(categories.name))

  return ok(rows)
}

export const createCategory = async (input: CreateCategoryInput): Promise<Result<Category>> => {
  const [category] = await db
    .insert(categories)
    .values({ name: input.name, displayOrder: input.displayOrder ?? 0 })
    .returning()

  return ok(category)
}

export const getCategoryById = async (id: number): Promise<Result<Category>> => {
  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1)

  if (!rows.length) return err(404, 'Not found')
  return ok(rows[0])
}

export const updateCategory = async (
  id: number,
  input: UpdateCategoryInput,
): Promise<Result<Category>> => {
  const [updated] = await db
    .update(categories)
    .set(input)
    .where(eq(categories.id, id))
    .returning()

  if (!updated) return err(404, 'Not found')
  return ok(updated)
}

export const deleteCategory = async (id: number): Promise<Result<void>> => {
  const existing = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).limit(1)
  if (!existing.length) return err(404, 'Not found')

  const activeInfra = await db
    .select({
      id: infrastructureElements.id,
      productId: infrastructureElements.productId,
      environmentId: infrastructureElements.environmentId,
      parameters: infrastructureElements.parameters,
    })
    .from(infrastructureElements)
    .innerJoin(products, eq(infrastructureElements.productId, products.id))
    .where(and(eq(products.categoryId, id), eq(infrastructureElements.status, 'active')))

  for (const infra of activeInfra) {
    await db.update(infrastructureElements).set({ status: 'decommissioning' }).where(eq(infrastructureElements.id, infra.id))
    triggerProductWebhooks(infra.productId, infra.environmentId, { ...infra.parameters, TF_ACTION: 'destroy' }).catch(console.error)
  }

  const deleted = await db.delete(categories).where(eq(categories.id, id)).returning({ id: categories.id })
  if (!deleted.length) return err(404, 'Not found')
  return ok(undefined)
}
