import { db } from '@/lib/db/client'
import {
  products,
  productTranslations,
  productEnvironments,
  productWebhooks,
  deploymentEnvironments,
  categories,
  type Product,
  type ProductTranslation,
  type ProductEnvironment,
  type ProductWebhook,
} from '@/lib/db/schema'
import { eq, sql, and } from 'drizzle-orm'
import { translateProduct } from '@/lib/ai'
import { ok, err, type Result } from '@/lib/services/result'

export interface ProductAdminRow {
  id: number
  categoryId: number
  baseLanguage: string
  createdAt: Date
  categoryName: string | null
  name: string
  description: string
}

export interface CreateProductInput {
  categoryId: number
  baseLanguage?: string
  name: string
  description?: string
}

export interface UpdateProductInput {
  categoryId?: number
  baseLanguage?: string
  name?: string
  description?: string
}

export interface CreateProductEnvironmentInput {
  environmentId: number
  price?: string
  currency?: string
  costCenterMode?: 'project' | 'select' | 'overhead'
  forcedCostCenter?: boolean
}

export interface UpdateProductEnvironmentInput {
  price?: string
  currency?: string
  costCenterMode?: 'project' | 'select' | 'overhead'
  forcedCostCenter?: boolean
}

export interface CreateWebhookInput {
  environmentId: number
  name: string
  webhookUrl: string
  webhookToken: string
  execOrder?: number
}

export interface UpdateWebhookInput {
  environmentId?: number
  name?: string
  webhookUrl?: string
  webhookToken?: string
  execOrder?: number
}

export interface UpsertTranslationInput {
  name: string
  description?: string
}

const adminProductSelect = {
  id: products.id,
  categoryId: products.categoryId,
  baseLanguage: products.baseLanguage,
  createdAt: products.createdAt,
  categoryName: categories.name,
  name: sql<string>`(
    SELECT name FROM product_translations
    WHERE product_id = ${products.id} AND language_code = 'en'
    LIMIT 1
  )`,
  description: sql<string>`(
    SELECT description FROM product_translations
    WHERE product_id = ${products.id} AND language_code = 'en'
    LIMIT 1
  )`,
}

export const listProducts = async (): Promise<Result<ProductAdminRow[]>> => {
  const rows = await db
    .select(adminProductSelect)
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .orderBy(products.id)

  return ok(rows as ProductAdminRow[])
}

export const createProduct = async (input: CreateProductInput): Promise<Result<ProductAdminRow>> => {
  const { categoryId, baseLanguage = 'de', name, description = '' } = input

  const [product] = await db
    .insert(products)
    .values({ categoryId, baseLanguage })
    .returning()

  await db
    .insert(productTranslations)
    .values({ productId: product.id, languageCode: baseLanguage, name, description })

  if (baseLanguage !== 'en') {
    await db
      .insert(productTranslations)
      .values({ productId: product.id, languageCode: 'en', name, description })
      .onConflictDoNothing()
  }

  return ok({ ...product, name, description, categoryName: null } as ProductAdminRow)
}

export const getProductAdmin = async (id: number): Promise<Result<ProductAdminRow>> => {
  const rows = await db
    .select(adminProductSelect)
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.id, id))
    .limit(1)

  if (!rows.length) return err(404, 'Not found')
  return ok(rows[0] as ProductAdminRow)
}

export const updateProduct = async (
  id: number,
  input: UpdateProductInput,
): Promise<Result<Product>> => {
  const { name, description, ...productFields } = input

  if (Object.keys(productFields).length > 0) {
    await db.update(products).set(productFields).where(eq(products.id, id))
  }

  if (name !== undefined || description !== undefined) {
    const productRows = await db
      .select({ baseLanguage: products.baseLanguage })
      .from(products)
      .where(eq(products.id, id))
      .limit(1)

    const lang = productRows[0]?.baseLanguage ?? 'en'
    const updateData: Partial<{ name: string; description: string }> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description

    await db
      .insert(productTranslations)
      .values({ productId: id, languageCode: lang, name: name ?? '', description: description ?? '' })
      .onConflictDoUpdate({
        target: [productTranslations.productId, productTranslations.languageCode],
        set: updateData,
      })

    if (lang !== 'en') {
      await db
        .insert(productTranslations)
        .values({ productId: id, languageCode: 'en', name: name ?? '', description: description ?? '' })
        .onConflictDoUpdate({
          target: [productTranslations.productId, productTranslations.languageCode],
          set: updateData,
        })
    }
  }

  const updated = await db
    .select()
    .from(products)
    .where(eq(products.id, id))
    .limit(1)

  return ok(updated[0])
}

export const deleteProduct = async (id: number): Promise<Result<void>> => {
  const deleted = await db
    .delete(products)
    .where(eq(products.id, id))
    .returning({ id: products.id })

  if (!deleted.length) return err(404, 'Not found')
  return ok(undefined)
}

export const updateProductImage = async (
  id: number,
  buffer: Buffer,
): Promise<Result<void>> => {
  await db.update(products).set({ image: buffer }).where(eq(products.id, id))
  return ok(undefined)
}

export const translateProductById = async (
  id: number,
): Promise<Result<{ languages: string[] }>> => {
  const productRows = await db
    .select({ baseLanguage: products.baseLanguage })
    .from(products)
    .where(eq(products.id, id))
    .limit(1)

  if (!productRows.length) return err(404, 'Product not found')

  const baseLanguage = productRows[0].baseLanguage

  const baseTranslationRows = await db
    .select({ name: productTranslations.name, description: productTranslations.description })
    .from(productTranslations)
    .where(sql`${productTranslations.productId} = ${id} AND ${productTranslations.languageCode} = ${baseLanguage}`)
    .limit(1)

  if (!baseTranslationRows.length) return err(404, 'Base translation not found')

  const { name, description } = baseTranslationRows[0]
  const translations = await translateProduct(name, description)

  for (const [lang, t] of Object.entries(translations)) {
    await db
      .insert(productTranslations)
      .values({ productId: id, languageCode: lang, name: t.name, description: t.description })
      .onConflictDoUpdate({
        target: [productTranslations.productId, productTranslations.languageCode],
        set: { name: t.name, description: t.description },
      })
  }

  return ok({ languages: Object.keys(translations) })
}

export const listTranslations = async (id: number): Promise<Result<ProductTranslation[]>> => {
  const rows = await db
    .select()
    .from(productTranslations)
    .where(eq(productTranslations.productId, id))
    .orderBy(productTranslations.languageCode)

  return ok(rows)
}

export const upsertTranslation = async (
  id: number,
  lang: string,
  input: UpsertTranslationInput,
): Promise<Result<ProductTranslation>> => {
  const [row] = await db
    .insert(productTranslations)
    .values({
      productId: id,
      languageCode: lang,
      name: input.name,
      description: input.description ?? '',
    })
    .onConflictDoUpdate({
      target: [productTranslations.productId, productTranslations.languageCode],
      set: { name: input.name, description: input.description ?? '' },
    })
    .returning()

  return ok(row)
}

export const listProductEnvironments = async (
  id: number,
): Promise<Result<(ProductEnvironment & { environmentName: string | null })[]>> => {
  const rows = await db
    .select({
      productId: productEnvironments.productId,
      environmentId: productEnvironments.environmentId,
      price: productEnvironments.price,
      currency: productEnvironments.currency,
      costCenterMode: productEnvironments.costCenterMode,
      forcedCostCenter: productEnvironments.forcedCostCenter,
      environmentName: deploymentEnvironments.name,
    })
    .from(productEnvironments)
    .leftJoin(
      deploymentEnvironments,
      eq(productEnvironments.environmentId, deploymentEnvironments.id),
    )
    .where(eq(productEnvironments.productId, id))

  return ok(rows as (ProductEnvironment & { environmentName: string | null })[])
}

export const createProductEnvironment = async (
  id: number,
  input: CreateProductEnvironmentInput,
): Promise<Result<ProductEnvironment>> => {
  const { environmentId, price = '0', currency = 'EUR', costCenterMode = 'project', forcedCostCenter = false } = input

  const [row] = await db
    .insert(productEnvironments)
    .values({ productId: id, environmentId, price, currency, costCenterMode, forcedCostCenter })
    .onConflictDoUpdate({
      target: [productEnvironments.productId, productEnvironments.environmentId],
      set: { price, currency, costCenterMode, forcedCostCenter },
    })
    .returning()

  return ok(row)
}

export const updateProductEnvironment = async (
  id: number,
  envId: number,
  input: UpdateProductEnvironmentInput,
): Promise<Result<ProductEnvironment>> => {
  const [updated] = await db
    .update(productEnvironments)
    .set(input)
    .where(
      and(
        eq(productEnvironments.productId, id),
        eq(productEnvironments.environmentId, envId),
      ),
    )
    .returning()

  if (!updated) return err(404, 'Not found')
  return ok(updated)
}

export const deleteProductEnvironment = async (
  id: number,
  envId: number,
): Promise<Result<void>> => {
  const deleted = await db
    .delete(productEnvironments)
    .where(
      and(
        eq(productEnvironments.productId, id),
        eq(productEnvironments.environmentId, envId),
      ),
    )
    .returning({ productId: productEnvironments.productId })

  if (!deleted.length) return err(404, 'Not found')
  return ok(undefined)
}

export const listProductWebhooks = async (id: number): Promise<Result<ProductWebhook[]>> => {
  const rows = await db
    .select()
    .from(productWebhooks)
    .where(eq(productWebhooks.productId, id))
    .orderBy(productWebhooks.execOrder)

  return ok(rows)
}

export const createProductWebhook = async (
  id: number,
  input: CreateWebhookInput,
): Promise<Result<ProductWebhook>> => {
  const [webhook] = await db
    .insert(productWebhooks)
    .values({ productId: id, ...input, execOrder: input.execOrder ?? 0 })
    .returning()

  return ok(webhook)
}

export const updateProductWebhook = async (
  id: number,
  whId: number,
  input: UpdateWebhookInput,
): Promise<Result<ProductWebhook>> => {
  const [updated] = await db
    .update(productWebhooks)
    .set(input)
    .where(and(eq(productWebhooks.id, whId), eq(productWebhooks.productId, id)))
    .returning()

  if (!updated) return err(404, 'Not found')
  return ok(updated)
}

export const deleteProductWebhook = async (id: number, whId: number): Promise<Result<void>> => {
  const deleted = await db
    .delete(productWebhooks)
    .where(and(eq(productWebhooks.id, whId), eq(productWebhooks.productId, id)))
    .returning({ id: productWebhooks.id })

  if (!deleted.length) return err(404, 'Not found')
  return ok(undefined)
}
