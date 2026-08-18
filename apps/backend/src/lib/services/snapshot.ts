import { db } from '@/lib/db/client'
import { productTranslations, productEnvironments, deploymentEnvironments } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { loadApplicableParameters, resolveParameterDefs } from '@/lib/services/catalog'

/**
 * Point-in-time capture of what a customer was actually offered (issue #38).
 *
 * Orders and infrastructure reference a product by id, so a later price change or
 * a removed parameter silently rewrites history: the order detail page would show
 * today's configuration as though it were the one that was approved. The snapshot
 * is what makes an order's own record of itself durable.
 *
 * Deliberately a denormalised JSON blob rather than a set of versioned rows. The
 * point is that it can never be changed by anything that happens to the catalogue
 * afterwards, and a foreign key into versioned tables would reintroduce exactly
 * that coupling. Migrating the shape is the price; it is the right one.
 */
export interface ParameterSnapshot {
  name: string
  label: string
  type: string
  description: string
  defaultValue: string
  required: boolean
  sensitive: boolean
}

export interface ProductSnapshot {
  /** Schema marker, so a reader can tell an old snapshot from a new one. */
  version: 1
  capturedAt: string
  productName: string
  productDescription: string
  environmentName: string
  price: string
  currency: string
  costCenterMode: string
  forcedCostCenter: boolean
  trialEnabled: boolean
  trialDurationMinutes: number
  parameters: ParameterSnapshot[]
}

/** Stand-in for a sensitive parameter's default value. */
export const REDACTED_DEFAULT = '[redacted]'

/**
 * Capture the product/environment offering as it stands right now.
 *
 * Returns null when the product is not offered in that environment — the caller
 * decides whether that is an error. Order creation has already validated the
 * offering by the time it snapshots, so for it a null means something raced.
 */
export const captureProductSnapshot = async (
  productId: number,
  categoryId: number,
  environmentId: number,
): Promise<ProductSnapshot | null> => {
  const [offering] = await db
    .select({
      price: productEnvironments.price,
      currency: productEnvironments.currency,
      costCenterMode: productEnvironments.costCenterMode,
      forcedCostCenter: productEnvironments.forcedCostCenter,
      trialEnabled: productEnvironments.trialEnabled,
      trialDurationMinutes: productEnvironments.trialDurationMinutes,
      environmentName: deploymentEnvironments.name,
    })
    .from(productEnvironments)
    .leftJoin(deploymentEnvironments, eq(productEnvironments.environmentId, deploymentEnvironments.id))
    .where(
      and(
        eq(productEnvironments.productId, productId),
        eq(productEnvironments.environmentId, environmentId),
      ),
    )
    .limit(1)

  if (!offering) return null

  const [translation] = await db
    .select({ name: productTranslations.name, description: productTranslations.description })
    .from(productTranslations)
    .where(
      and(
        eq(productTranslations.productId, productId),
        eq(productTranslations.languageCode, 'en'),
      ),
    )
    .limit(1)

  // The same resolution the order form rendered and the order service validated
  // against, so the snapshot records the definitions that actually applied rather
  // than every row that happened to match.
  const defs = resolveParameterDefs(
    await loadApplicableParameters(productId, categoryId, environmentId),
  )

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    productName: translation?.name ?? `Product #${productId}`,
    productDescription: translation?.description ?? '',
    environmentName: offering.environmentName ?? `Environment #${environmentId}`,
    price: offering.price,
    currency: offering.currency,
    costCenterMode: offering.costCenterMode,
    forcedCostCenter: offering.forcedCostCenter,
    trialEnabled: offering.trialEnabled,
    trialDurationMinutes: offering.trialDurationMinutes,
    parameters: defs
      .map((def) => ({
        name: def.name,
        label: def.label,
        type: def.type,
        description: def.description,
        // A sensitive parameter's default can be a placeholder secret, and the
        // snapshot is rendered on a page the ORDERER sees. The definition is worth
        // recording; its default is not worth leaking.
        defaultValue: def.sensitive ? REDACTED_DEFAULT : def.defaultValue,
        required: def.required,
        sensitive: def.sensitive,
      }))
      // Stable order so two snapshots of the same configuration diff as identical.
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}
