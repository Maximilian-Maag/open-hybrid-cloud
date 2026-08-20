import { db } from '@/lib/db/client'
import {
  products,
  productTranslations,
  productEnvironments,
  productWebhooks,
  deploymentEnvironments,
  categories,
  costCenters,
  infrastructureElements,
  parameters,
  type Product,
  type ProductTranslation,
  type ProductEnvironment,
  type ProductWebhook,
  type Parameter,
} from '@/lib/db/schema'
import { eq, sql, and, inArray } from 'drizzle-orm'
import { translateProduct } from '@/lib/ai'
import { ok, err, type Result } from '@/lib/services/result'
import { fireDestroyTriggers } from '@/lib/services/teardown'
import { recordProductVersion } from '@/lib/services/versions'

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
  /** Optional free text describing the change (issue #38). */
  changelog?: string
  /** Recorded as the version's author. */
  userId?: number | null
}

export interface CreateProductEnvironmentInput {
  environmentId: number
  /** Optional free text describing the change (issue #38). */
  changelog?: string
  userId?: number | null
  price?: string
  currency?: string
  costCenterMode?: 'project' | 'select' | 'overhead'
  forcedCostCenter?: boolean
  overheadCostCenterId?: number | null
  trialEnabled?: boolean
  trialDurationMinutes?: number
}

export interface UpdateProductEnvironmentInput {
  changelog?: string
  userId?: number | null
  price?: string
  currency?: string
  costCenterMode?: 'project' | 'select' | 'overhead'
  forcedCostCenter?: boolean
  overheadCostCenterId?: number | null
  trialEnabled?: boolean
  trialDurationMinutes?: number
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

export const getProductAdmin = async (id: number): Promise<Result<ProductAdminRow & { environments: ProductEnvironment[]; parameters: Parameter[] }>> => {
  const rows = await db
    .select(adminProductSelect)
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.id, id))
    .limit(1)

  if (!rows.length) return err(404, 'Not found')

  const envRows = await db
    .select({
      productId: productEnvironments.productId,
      environmentId: productEnvironments.environmentId,
      price: productEnvironments.price,
      currency: productEnvironments.currency,
      costCenterMode: productEnvironments.costCenterMode,
      forcedCostCenter: productEnvironments.forcedCostCenter,
      overheadCostCenterId: productEnvironments.overheadCostCenterId,
      trialEnabled: productEnvironments.trialEnabled,
      trialDurationMinutes: productEnvironments.trialDurationMinutes,
    })
    .from(productEnvironments)
    .where(eq(productEnvironments.productId, id))

  const paramRows = await db
    .select()
    .from(parameters)
    .where(and(eq(parameters.scope, 'product'), eq(parameters.scopeId, id)))

  return ok({ ...rows[0], environments: envRows, parameters: paramRows } as ProductAdminRow & { environments: ProductEnvironment[]; parameters: Parameter[] })
}

export const updateProduct = async (
  id: number,
  input: UpdateProductInput,
): Promise<Result<Product>> => {
  const { name, description, changelog, userId, ...productFields } = input

  const existing = await db
    .select({ id: products.id, baseLanguage: products.baseLanguage })
    .from(products)
    .where(eq(products.id, id))
    .limit(1)

  if (!existing.length) return err(404, 'Not found')

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

  // A product-level change is not specific to one environment, so it carries no
  // offering snapshot — there is no single one to take.
  await recordProductVersion({
    productId: id,
    environmentId: null,
    summary: describeProductChange(input),
    changelog,
    userId: userId ?? null,
  })

  return ok(updated[0])
}

const describeProductChange = (input: UpdateProductInput): string => {
  const changed: string[] = []
  if (input.name !== undefined) changed.push('name')
  if (input.description !== undefined) changed.push('description')
  if (input.categoryId !== undefined) changed.push('category')
  if (input.baseLanguage !== undefined) changed.push('base language')
  return changed.length > 0 ? `Product updated: ${changed.join(', ')}` : 'Product updated'
}

export const deleteProduct = async (id: number): Promise<Result<void>> => {
  const existing = await db.select({ id: products.id }).from(products).where(eq(products.id, id)).limit(1)
  if (!existing.length) return err(404, 'Not found')

  const activeInfra = await db
    .select({ id: infrastructureElements.id, orderId: infrastructureElements.orderId, productId: infrastructureElements.productId, environmentId: infrastructureElements.environmentId, parameters: infrastructureElements.parameters })
    .from(infrastructureElements)
    .where(and(eq(infrastructureElements.productId, id), eq(infrastructureElements.status, 'active')))

  // Await the destroy trigger request BEFORE deleting the product. The delete
  // cascades to infrastructure_elements (ON DELETE CASCADE); firing the webhook
  // fire-and-forget raced the cascade. NOTE: awaiting only guarantees the CI
  // system accepted the trigger — the destroy pipeline still runs asynchronously
  // afterwards, so a late failure cannot be reconciled once the rows are gone.
  const triggerFailures: string[] = []
  for (const infra of activeInfra) {
    // Atomically claim the row (active → decommissioning) so two concurrent
    // deletes can't both fire a destroy pipeline for the same element.
    const claimed = await db
      .update(infrastructureElements)
      .set({ status: 'decommissioning' })
      .where(and(eq(infrastructureElements.id, infra.id), eq(infrastructureElements.status, 'active')))
      .returning({ id: infrastructureElements.id })
    if (!claimed.length) continue
    const destroyVars = { ...infra.parameters, TF_ACTION: 'destroy', INFRA_ID: String(infra.id), ORDER_ID: String(infra.orderId) }
    try {
      // Fires destroy for BOTH product webhooks and pipeline stacks — stack-
      // provisioned infra would otherwise leak on product deletion.
      const outcome = await fireDestroyTriggers(infra, destroyVars)
      triggerFailures.push(...outcome.failures.map((f) => `infra #${infra.id}: ${f}`))
    } catch (e) {
      console.error(e)
      triggerFailures.push(`infra #${infra.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Block the delete when any destroy could not be started. Deleting anyway
  // cascades the infrastructure_elements rows away, which would leave the
  // provisioned infrastructure running with nothing left to reconcile it
  // against. The claimed rows keep their state (fireDestroyTriggers hands back
  // the ones where nothing started), so the operator can retry.
  if (triggerFailures.length > 0) {
    return err(
      502,
      `Cannot delete product: ${triggerFailures.length} destroy trigger(s) could not be started, so deleting now would leak infrastructure. Fix and retry — ${triggerFailures.join('; ')}`,
    )
  }

  const deleted = await db.delete(products).where(eq(products.id, id)).returning({ id: products.id })
  if (!deleted.length) return err(404, 'Not found')
  return ok(undefined)
}

/**
 * Image types a product picture may have.
 *
 * SVG is deliberately absent: it is a document that can carry script, and this
 * file is served back to browsers from the product page. PNG, JPEG and WebP cover
 * what an operator would upload.
 */
export const ALLOWED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const

/** 10 MB — the limit the admin guide has always claimed and nothing enforced. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * Magic bytes per accepted type.
 *
 * The declared Content-Type of an upload is attacker-controlled, so it decides
 * nothing on its own: what gets stored is the type the bytes actually are.
 */
const MAGIC: { mime: (typeof ALLOWED_IMAGE_MIMES)[number]; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/webp',
    test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
]

/** The type these bytes really are, or null if it is not one we accept. */
export const detectImageMime = (buffer: Buffer): string | null =>
  MAGIC.find((candidate) => buffer.length >= 12 && candidate.test(buffer))?.mime ?? null

/** Longest useful alt text; beyond this it is a description, not a label. */
export const MAX_IMAGE_ALT_LENGTH = 300

export const updateProductImage = async (
  id: number,
  buffer: Buffer,
  alt: string,
): Promise<Result<{ mime: string }>> => {
  // Required, not optional: an empty alt is a claim that the picture carries no
  // information, and only the person uploading it can make that claim. Every
  // component that renders it used to decide for itself — the catalogue tile and
  // the cart thumbnail passed "", the product page passed the product name.
  const description = alt.trim()
  if (description === '') return err(400, 'An image description is required')
  if (description.length > MAX_IMAGE_ALT_LENGTH) {
    return err(400, `The image description must be at most ${MAX_IMAGE_ALT_LENGTH} characters`)
  }

  if (buffer.length === 0) return err(400, 'The uploaded file is empty')
  if (buffer.length > MAX_IMAGE_BYTES) {
    return err(413, `Image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB`)
  }

  const mime = detectImageMime(buffer)
  if (mime === null) {
    return err(415, `Unsupported image type — allowed: ${ALLOWED_IMAGE_MIMES.join(', ')}`)
  }

  const updated = await db
    .update(products)
    .set({ image: buffer, imageMime: mime, imageAlt: description })
    .where(eq(products.id, id))
    .returning({ id: products.id })

  // Previously this silently reported success for a product id that does not
  // exist, because an UPDATE matching no rows is not an error.
  if (updated.length === 0) return err(404, 'Product not found')

  return ok({ mime })
}

export const updateProductImageAlt = async (id: number, alt: string): Promise<Result<void>> => {
  const description = alt.trim()
  if (description === '') return err(400, 'An image description is required')
  if (description.length > MAX_IMAGE_ALT_LENGTH) {
    return err(400, `The image description must be at most ${MAX_IMAGE_ALT_LENGTH} characters`)
  }

  const [row] = await db
    .select({ hasImage: products.image })
    .from(products)
    .where(eq(products.id, id))
    .limit(1)

  if (!row) return err(404, 'Product not found')
  // Describing a picture that is not there would leave a description behind for
  // whatever is uploaded next.
  if (!row.hasImage) return err(409, 'This product has no image to describe')

  await db.update(products).set({ imageAlt: description }).where(eq(products.id, id))
  return ok(undefined)
}

export const deleteProductImage = async (id: number): Promise<Result<void>> => {
  const updated = await db
    .update(products)
    .set({ image: null, imageMime: null, imageAlt: null })
    .where(eq(products.id, id))
    .returning({ id: products.id })

  if (updated.length === 0) return err(404, 'Product not found')
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
      overheadCostCenterId: productEnvironments.overheadCostCenterId,
      trialEnabled: productEnvironments.trialEnabled,
      trialDurationMinutes: productEnvironments.trialDurationMinutes,
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

/**
 * Reject an overhead account that does not exist or has been deactivated.
 *
 * Ordering already refuses an inactive cost centre, so accepting one here would
 * only defer the failure to the next order placed against the offering — at
 * which point the operator who misconfigured it is long gone.
 */
const validateOverheadCostCenter = async (
  overheadCostCenterId: number | null | undefined,
): Promise<Result<void>> => {
  if (overheadCostCenterId === undefined || overheadCostCenterId === null) return ok(undefined)

  const [cc] = await db
    .select({ active: costCenters.active })
    .from(costCenters)
    .where(eq(costCenters.id, overheadCostCenterId))
    .limit(1)

  if (!cc) return err(400, 'Overhead cost center not found')
  if (!cc.active) return err(400, 'Overhead cost center is not active')
  return ok(undefined)
}

export const createProductEnvironment = async (
  id: number,
  input: CreateProductEnvironmentInput,
): Promise<Result<ProductEnvironment>> => {
  const {
    environmentId,
    price = '0',
    currency = 'EUR',
    costCenterMode = 'project',
    forcedCostCenter = false,
    overheadCostCenterId = null,
    trialEnabled = false,
    trialDurationMinutes = 30,
  } = input

  const validated = await validateOverheadCostCenter(overheadCostCenterId)
  if (!validated.ok) return validated

  // A non-positive duration would schedule the teardown at or before the moment of
  // provisioning, so the trial would be swept away before it came up.
  if (trialEnabled && trialDurationMinutes <= 0) {
    return err(400, 'The trial duration must be at least one minute')
  }

  const values = {
    price, currency, costCenterMode, forcedCostCenter, overheadCostCenterId,
    trialEnabled, trialDurationMinutes,
  }

  // Read before the write so the version entry can say what actually changed
  // rather than just "saved".
  const [previous] = await db
    .select()
    .from(productEnvironments)
    .where(
      and(
        eq(productEnvironments.productId, id),
        eq(productEnvironments.environmentId, environmentId),
      ),
    )
    .limit(1)

  const [row] = await db
    .insert(productEnvironments)
    .values({ productId: id, environmentId, ...values })
    .onConflictDoUpdate({
      target: [productEnvironments.productId, productEnvironments.environmentId],
      set: values,
    })
    .returning()

  await recordProductVersion({
    productId: id,
    environmentId,
    summary: previous ? describeOfferingChange(previous, row) : 'Environment offered',
    changelog: input.changelog,
    userId: input.userId ?? null,
  })

  return ok(row)
}

/**
 * Name the fields that changed, for the history row's summary.
 *
 * A summary derived from the actual before/after rather than from which fields the
 * request happened to include: the admin form submits every field on every save, so
 * "what was sent" would report a change on every row every time.
 */
const describeOfferingChange = (
  before: ProductEnvironment,
  after: ProductEnvironment,
): string => {
  const fields: (keyof ProductEnvironment)[] = [
    'price', 'currency', 'costCenterMode', 'forcedCostCenter',
    'overheadCostCenterId', 'trialEnabled', 'trialDurationMinutes',
  ]
  const changed = fields.filter((f) => String(before[f] ?? '') !== String(after[f] ?? ''))
  return changed.length > 0 ? `Offering updated: ${changed.join(', ')}` : 'Offering saved (no change)'
}

export const updateProductEnvironment = async (
  id: number,
  envId: number,
  input: UpdateProductEnvironmentInput,
): Promise<Result<ProductEnvironment>> => {
  const validated = await validateOverheadCostCenter(input.overheadCostCenterId)
  if (!validated.ok) return validated

  if (input.trialDurationMinutes !== undefined && input.trialDurationMinutes <= 0) {
    return err(400, 'The trial duration must be at least one minute')
  }

  const [previous] = await db
    .select()
    .from(productEnvironments)
    .where(
      and(
        eq(productEnvironments.productId, id),
        eq(productEnvironments.environmentId, envId),
      ),
    )
    .limit(1)

  const { changelog, userId, ...columns } = input
  const [updated] = await db
    .update(productEnvironments)
    .set(columns)
    .where(
      and(
        eq(productEnvironments.productId, id),
        eq(productEnvironments.environmentId, envId),
      ),
    )
    .returning()

  if (!updated) return err(404, 'Not found')

  await recordProductVersion({
    productId: id,
    environmentId: envId,
    summary: previous ? describeOfferingChange(previous, updated) : 'Offering updated',
    changelog,
    userId: userId ?? null,
  })

  return ok(updated)
}

export const deleteProductEnvironment = async (
  id: number,
  envId: number,
): Promise<Result<void>> => {
  // Refuse while infrastructure is still live in this environment. Unlike
  // deleteProduct there is no cascade to follow here — infrastructure_elements
  // references products/deployment_environments directly — so removing the
  // offering would silently strand running infra without the price, currency
  // and cost-centre config that its order was placed under. Decommission first.
  const liveInfra = await db
    .select({ id: infrastructureElements.id })
    .from(infrastructureElements)
    .where(
      and(
        eq(infrastructureElements.productId, id),
        eq(infrastructureElements.environmentId, envId),
        inArray(infrastructureElements.status, ['active', 'decommissioning']),
      ),
    )
    .limit(1)

  if (liveInfra.length) {
    return err(409, 'Infrastructure is still deployed in this environment — decommission it first')
  }

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

  // Recorded without a snapshot: there is no offering left to capture, and the
  // withdrawal is exactly what a reader of the history needs to see.
  await recordProductVersion({
    productId: id,
    environmentId: null,
    summary: `Environment #${envId} withdrawn`,
    userId: null,
  })

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
