import type { SessionUser } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import {
  orders,
  projects,
  productEnvironments,
  productTranslations,
  costCenters,
  deploymentEnvironments,
  infrastructureElements,
  exchangeRates,
} from '@/lib/db/schema'
import { and, eq, gte, lte, inArray, sql } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'

/**
 * Spending overview (issue #32).
 *
 * ── What counts as spend ──────────────────────────────────────────────────────
 * Only orders that actually reached provisioning: 'provisioning' and 'completed'.
 * A rejected or pending order never cost anything, and counting it would inflate
 * every figure on the page. A 'failed' order is excluded too — its pipeline did not
 * deliver infrastructure — which means a retried order (issue #29) starts counting
 * again once it succeeds, not twice.
 *
 * ── Which price ───────────────────────────────────────────────────────────────
 * The price stored in the order's snapshot (issue #38), which is what the customer
 * was actually charged at the time. Falling back to the offering's CURRENT price
 * would silently restate history every time an admin edits a price — the exact
 * problem snapshots exist to prevent. Orders that predate snapshots have none, so
 * they fall back to the current price and are counted in `estimatedOrders` so the
 * total can be read with that in mind rather than presented as exact.
 *
 * ── What the figures are NOT ───────────────────────────────────────────────────
 * `product_environments.price` records an amount and a currency but no billing
 * period, so there is no honest way to derive a monthly run rate from it. These
 * are sums of the recorded price of each provisioned order in the window, not a
 * time-based projection. The UI says so.
 */

export type CostGrouping = 'project' | 'costCenter' | 'product' | 'environment'

export interface CostFilters {
  from?: Date
  to?: Date
  /** Narrow to one project. Ignored when the caller cannot see it. */
  projectId?: number
}

export interface CostBucket {
  id: number | null
  label: string
  /** Total in EUR, the rate base. The client converts to the viewer's currency. */
  totalEur: number
  orderCount: number
}

export interface CostReport {
  totalEur: number
  orderCount: number
  /** Orders whose price came from the live offering because they predate snapshots. */
  estimatedOrders: number
  byProject: CostBucket[]
  byCostCenter: CostBucket[]
  byProduct: CostBucket[]
  byEnvironment: CostBucket[]
  /**
   * Amounts that could not be converted because no rate is stored for their
   * currency. Surfaced rather than dropped: a silently missing currency would make
   * the total quietly wrong.
   */
  unconverted: { currency: string; amount: number }[]
  /** True when the caller sees every project's spend. */
  global: boolean
}

/** Statuses that represent infrastructure that was actually provisioned. */
const SPENDING_STATUSES = ['provisioning', 'completed'] as const

interface CostRow {
  orderId: number
  projectId: number
  projectName: string | null
  costCenterId: number | null
  costCenterLabel: string | null
  productId: number
  productName: string | null
  environmentId: number
  environmentName: string | null
  snapshotPrice: string | null
  snapshotCurrency: string | null
  livePrice: string | null
  liveCurrency: string | null
  infraStatus: string | null
}

export const getCostReport = async (
  session: SessionUser,
  filters: CostFilters = {},
): Promise<Result<CostReport>> => {
  const isAdmin = session.role === 'admin' || session.role === 'root'

  const conditions = [inArray(orders.status, [...SPENDING_STATUSES])]

  // A project manager sees the spend of the projects they OWN, not merely the
  // orders they placed: cost is a property of the project they are accountable for,
  // and an order somebody else placed into it still spends their budget.
  if (!isAdmin) conditions.push(eq(projects.ownerId, session.id))

  if (filters.projectId !== undefined) conditions.push(eq(orders.projectId, filters.projectId))
  if (filters.from) conditions.push(gte(orders.createdAt, filters.from))
  if (filters.to) conditions.push(lte(orders.createdAt, filters.to))

  const rows = (await db
    .select({
      orderId: orders.id,
      projectId: orders.projectId,
      projectName: projects.name,
      costCenterId: orders.costCenterId,
      costCenterLabel: sql<string>`${costCenters.code} || ' — ' || ${costCenters.name}`,
      productId: orders.productId,
      productName: productTranslations.name,
      environmentId: orders.environmentId,
      environmentName: deploymentEnvironments.name,
      // The snapshot is the authoritative price: what the customer was charged.
      snapshotPrice: sql<string | null>`${orders.productSnapshot} ->> 'price'`,
      snapshotCurrency: sql<string | null>`${orders.productSnapshot} ->> 'currency'`,
      livePrice: productEnvironments.price,
      liveCurrency: productEnvironments.currency,
      infraStatus: infrastructureElements.status,
    })
    .from(orders)
    .leftJoin(projects, eq(orders.projectId, projects.id))
    .leftJoin(costCenters, eq(orders.costCenterId, costCenters.id))
    .leftJoin(
      productTranslations,
      and(
        eq(orders.productId, productTranslations.productId),
        eq(productTranslations.languageCode, 'en'),
      ),
    )
    .leftJoin(deploymentEnvironments, eq(orders.environmentId, deploymentEnvironments.id))
    // Left: an offering withdrawn since the order was placed must not drop the
    // order out of the report, which would make past spend disappear.
    .leftJoin(
      productEnvironments,
      and(
        eq(orders.productId, productEnvironments.productId),
        eq(orders.environmentId, productEnvironments.environmentId),
      ),
    )
    .leftJoin(infrastructureElements, eq(infrastructureElements.orderId, orders.id))
    .where(and(...conditions))) as CostRow[]

  const rates = await loadRates()

  let totalEur = 0
  let estimatedOrders = 0
  const unconverted = new Map<string, number>()
  const buckets: Record<CostGrouping, Map<string, CostBucket>> = {
    project: new Map(),
    costCenter: new Map(),
    product: new Map(),
    environment: new Map(),
  }

  // One order can join to several infrastructure rows; count each order once.
  const seen = new Set<number>()

  for (const row of rows) {
    if (seen.has(row.orderId)) continue
    seen.add(row.orderId)

    const usingSnapshot = row.snapshotPrice !== null && row.snapshotCurrency !== null
    const rawPrice = usingSnapshot ? row.snapshotPrice : row.livePrice
    const currency = (usingSnapshot ? row.snapshotCurrency : row.liveCurrency) ?? 'EUR'
    if (!usingSnapshot) estimatedOrders += 1

    const amount = Number(rawPrice ?? '0')
    // An unparseable or absent price contributes nothing rather than NaN, which
    // would poison every total it touched.
    if (!Number.isFinite(amount) || amount === 0) {
      addTo(buckets, row, 0)
      continue
    }

    const eur = toEur(amount, currency, rates)
    if (eur === null) {
      unconverted.set(currency, (unconverted.get(currency) ?? 0) + amount)
      addTo(buckets, row, 0)
      continue
    }

    totalEur += eur
    addTo(buckets, row, eur)
  }

  return ok({
    totalEur: round(totalEur),
    orderCount: seen.size,
    estimatedOrders,
    byProject: finalise(buckets.project),
    byCostCenter: finalise(buckets.costCenter),
    byProduct: finalise(buckets.product),
    byEnvironment: finalise(buckets.environment),
    unconverted: [...unconverted.entries()].map(([currency, amount]) => ({
      currency,
      amount: round(amount),
    })),
    global: isAdmin,
  })
}

const addTo = (
  buckets: Record<CostGrouping, Map<string, CostBucket>>,
  row: CostRow,
  eur: number,
): void => {
  bump(buckets.project, row.projectId, row.projectName ?? `Project #${row.projectId}`, eur)
  bump(
    buckets.costCenter,
    row.costCenterId,
    // 'project' cost-centre mode stores none on the order, so these orders are
    // grouped under an explicit label rather than dropped from the breakdown.
    row.costCenterLabel ?? 'No cost centre',
    eur,
  )
  bump(buckets.product, row.productId, row.productName ?? `Product #${row.productId}`, eur)
  bump(buckets.environment, row.environmentId, row.environmentName ?? `Environment #${row.environmentId}`, eur)
}

const bump = (
  bucket: Map<string, CostBucket>,
  id: number | null,
  label: string,
  eur: number,
): void => {
  const key = String(id ?? 'none')
  const existing = bucket.get(key)
  if (existing) {
    existing.totalEur += eur
    existing.orderCount += 1
    return
  }
  bucket.set(key, { id, label, totalEur: eur, orderCount: 1 })
}

/** Largest spend first — the point of the page is to see where the money goes. */
const finalise = (bucket: Map<string, CostBucket>): CostBucket[] =>
  [...bucket.values()]
    .map((b) => ({ ...b, totalEur: round(b.totalEur) }))
    .sort((a, b) => b.totalEur - a.totalEur || a.label.localeCompare(b.label))

const loadRates = async (): Promise<Record<string, number>> => {
  const rows = await db.select().from(exchangeRates)
  const rates: Record<string, number> = {}
  for (const row of rows) {
    const rate = Number(row.rate)
    if (Number.isFinite(rate) && rate > 0) rates[row.currencyCode] = rate
  }
  return rates
}

/**
 * Convert to EUR, the base the stored rates are relative to.
 *
 * Returns null when no rate is stored, so the caller can report the amount as
 * unconverted instead of quietly treating it as EUR — which would misstate the
 * total by whatever the exchange rate happens to be.
 */
const toEur = (amount: number, currency: string, rates: Record<string, number>): number | null => {
  if (currency === 'EUR') return amount
  const rate = rates[currency]
  if (!rate) return null
  return amount / rate
}

/** Money, so two decimals — and no floating-point tail in the JSON. */
const round = (value: number): number => Math.round(value * 100) / 100

/**
 * Flat rows for the CSV/PDF export, one per counted order.
 *
 * Separate from the aggregate so the export can be reconciled: a total nobody can
 * break down is a total nobody trusts.
 */
export interface CostRowExport {
  orderId: number
  createdAt: Date | null
  projectName: string
  costCenter: string
  productName: string
  environmentName: string
  status: string
  price: string
  currency: string
  priceEur: number | null
  /** True when the price came from the live offering, not the order's snapshot. */
  estimated: boolean
}

export const getCostRows = async (
  session: SessionUser,
  filters: CostFilters = {},
): Promise<Result<CostRowExport[]>> => {
  const isAdmin = session.role === 'admin' || session.role === 'root'

  const conditions = [inArray(orders.status, [...SPENDING_STATUSES])]
  if (!isAdmin) conditions.push(eq(projects.ownerId, session.id))
  if (filters.projectId !== undefined) conditions.push(eq(orders.projectId, filters.projectId))
  if (filters.from) conditions.push(gte(orders.createdAt, filters.from))
  if (filters.to) conditions.push(lte(orders.createdAt, filters.to))

  const rows = await db
    .select({
      orderId: orders.id,
      createdAt: orders.createdAt,
      status: orders.status,
      projectName: projects.name,
      costCenterLabel: sql<string>`${costCenters.code} || ' — ' || ${costCenters.name}`,
      productName: productTranslations.name,
      environmentName: deploymentEnvironments.name,
      snapshotPrice: sql<string | null>`${orders.productSnapshot} ->> 'price'`,
      snapshotCurrency: sql<string | null>`${orders.productSnapshot} ->> 'currency'`,
      livePrice: productEnvironments.price,
      liveCurrency: productEnvironments.currency,
      projectId: orders.projectId,
      productId: orders.productId,
      environmentId: orders.environmentId,
    })
    .from(orders)
    .leftJoin(projects, eq(orders.projectId, projects.id))
    .leftJoin(costCenters, eq(orders.costCenterId, costCenters.id))
    .leftJoin(
      productTranslations,
      and(
        eq(orders.productId, productTranslations.productId),
        eq(productTranslations.languageCode, 'en'),
      ),
    )
    .leftJoin(deploymentEnvironments, eq(orders.environmentId, deploymentEnvironments.id))
    .leftJoin(
      productEnvironments,
      and(
        eq(orders.productId, productEnvironments.productId),
        eq(orders.environmentId, productEnvironments.environmentId),
      ),
    )
    .where(and(...conditions))
    .orderBy(sql`${orders.createdAt} DESC`, sql`${orders.id} DESC`)

  const rates = await loadRates()

  return ok(
    rows.map((row) => {
      const usingSnapshot = row.snapshotPrice !== null && row.snapshotCurrency !== null
      const price = (usingSnapshot ? row.snapshotPrice : row.livePrice) ?? '0'
      const currency = (usingSnapshot ? row.snapshotCurrency : row.liveCurrency) ?? 'EUR'
      const amount = Number(price)
      const eur = Number.isFinite(amount) ? toEur(amount, currency, rates) : null
      return {
        orderId: row.orderId,
        createdAt: row.createdAt,
        projectName: row.projectName ?? `Project #${row.projectId}`,
        costCenter: row.costCenterLabel ?? '',
        productName: row.productName ?? `Product #${row.productId}`,
        environmentName: row.environmentName ?? `Environment #${row.environmentId}`,
        status: row.status,
        price,
        currency,
        priceEur: eur === null ? null : round(eur),
        estimated: !usingSnapshot,
      }
    }),
  )
}

/**
 * Confirm a project filter names something the caller may see.
 *
 * Without this an unauthorised projectId would simply produce an empty report,
 * which reads as "this project has no spend" rather than "not yours".
 */
export const assertMaySeeProject = async (
  session: SessionUser,
  projectId: number,
): Promise<Result<void>> => {
  if (session.role === 'admin' || session.role === 'root') return ok(undefined)

  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) return err(404, 'Project not found')
  if (project.ownerId !== session.id) return err(403, 'Forbidden')
  return ok(undefined)
}
