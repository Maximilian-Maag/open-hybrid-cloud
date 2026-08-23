import { db } from '@/lib/db/client'
import { countWhere } from '@/lib/db/queries'
import {
  categories,
  products,
  productEnvironments,
  cartItems,
  productFavorites,
  infrastructureElements,
  orders,
  type Category,
} from '@/lib/db/schema'
import { count, eq, asc, and, isNull, inArray } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'
import { triggerProductWebhooks } from '@/lib/ci/webhooks'
import { withoutReservedCiVariables } from '@/lib/ci/reserved'
import { logAudit, changedFields } from '@/lib/audit'
import { isEmptyUpdate, EMPTY_UPDATE_MESSAGE } from '@/lib/services/updates'

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
    // A retired category survives only as the referent of its retired products
    // (issue #142); it must not show up in the shop's navigation or the admin list.
    .where(isNull(categories.retiredAt))
    .orderBy(asc(categories.displayOrder), asc(categories.name))

  return ok(rows)
}

export const createCategory = async (
  input: CreateCategoryInput,
  actorId?: number,
): Promise<Result<Category>> => {
  const [category] = await db
    .insert(categories)
    .values({ name: input.name, displayOrder: input.displayOrder ?? 0 })
    .returning()

  await logAudit(actorId ?? null, 'category.created', category.id, `Created category ${category.name}`)

  return ok(category)
}

export const getCategoryById = async (id: number): Promise<Result<Category>> => {
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), isNull(categories.retiredAt)))
    .limit(1)

  if (!rows.length) return err(404, 'Not found')
  return ok(rows[0])
}

export const updateCategory = async (
  id: number,
  input: UpdateCategoryInput,
  actorId?: number,
): Promise<Result<Category>> => {
  if (isEmptyUpdate(input)) return err(400, EMPTY_UPDATE_MESSAGE)

  const [updated] = await db
    .update(categories)
    .set(input)
    .where(eq(categories.id, id))
    .returning()

  if (!updated) return err(404, 'Not found')

  await logAudit(actorId ?? null, 'category.updated', id, changedFields(input))

  return ok(updated)
}

export const deleteCategory = async (id: number, actorId?: number): Promise<Result<void>> => {
  const existing = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    // An already-retired category is gone from every screen, so deleting it again
    // is a 404 like any other missing category.
    .where(and(eq(categories.id, id), isNull(categories.retiredAt)))
    .limit(1)
  if (!existing.length) return err(404, 'Not found')

  // Deleting a category cascades to its products (categories → products is ON
  // DELETE CASCADE) and from there to their orders (orders.product_id is too), so
  // this endpoint erased order history one level deeper than deleteProduct did
  // (issue #142). Same answer, applied one level up: if anything in this category
  // has ever been ordered, the category and those products are RETIRED rather than
  // deleted, so the rows the orders point at survive. The destroy triggers below
  // still fire either way — FA-09.6 does not depend on which of the two happens.
  // Counted by Postgres rather than selected and measured: the figure is exact
  // because the audit entry below quotes it, and this join spans every order of
  // every product in the category — the widest of these checks by row count.
  const orderCount = await countWhere(
    db
      .select({ n: count() })
      .from(orders)
      .innerJoin(products, eq(orders.productId, products.id))
      .where(eq(products.categoryId, id)),
  )
  const retire = orderCount > 0

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
    triggerProductWebhooks(infra.productId, infra.environmentId, {
      ...withoutReservedCiVariables(infra.parameters as Record<string, string>),
      TF_ACTION: 'destroy',
    }).catch(console.error)
  }

  if (retire) {
    const retiredAt = new Date()
    await db.transaction(async (tx) => {
      await tx.update(categories).set({ retiredAt }).where(eq(categories.id, id))

      // Retire every product in the category and withdraw their offerings, exactly
      // as deleteProduct does — cart-add and order creation both require an
      // offering, so this is what makes them unorderable. Products in the category
      // that were never ordered are retired too rather than deleted piecemeal: the
      // category is gone from every list either way, and one rule is easier to
      // reason about than two.
      const inCategory = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.categoryId, id), isNull(products.retiredAt)))
      const ids = inCategory.map((p) => p.id)
      if (ids.length > 0) {
        await tx.update(products).set({ retiredAt }).where(inArray(products.id, ids))
        await tx.delete(productEnvironments).where(inArray(productEnvironments.productId, ids))
        await tx.delete(cartItems).where(inArray(cartItems.productId, ids))
        await tx.delete(productFavorites).where(inArray(productFavorites.productId, ids))
      }
    })

    await logAudit(
      actorId ?? null,
      'category.retired',
      id,
      `Retired category ${existing[0].name} (${orderCount} order(s) keep their history)`,
    )

    return ok(undefined)
  }

  const deleted = await db.delete(categories).where(eq(categories.id, id)).returning({ id: categories.id })
  if (!deleted.length) return err(404, 'Not found')

  await logAudit(actorId ?? null, 'category.deleted', id, `Deleted category ${existing[0].name}`)

  return ok(undefined)
}
