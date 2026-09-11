import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/lib/db/client'
import { logAudit } from '@/lib/audit'
import { ok, err, type Result } from '@/lib/services/result'
import { costCenters, orders, projects, exchangeRates, productEnvironments } from '@/lib/db/schema'
import { linePriceSql, lineCurrencySql } from '@/lib/services/sizes'

/**
 * What a cost centre has committed, and whether an order may be placed against it (#325).
 *
 * Two things here are decisions rather than mechanics, and both are written down
 * because the numbers are meaningless without them.
 *
 * ── "Monthly" means orders PLACED in the calendar month ─────────────────────
 *
 * `product_environments.price` carries an amount and a currency and no billing
 * period, so there is no honest way to derive a run rate from it — `costs.ts`
 * says the same thing about its own figures. A machine provisioned in January
 * and still running in June therefore consumes budget in January only, and a
 * long-lived estate looks cheaper than it is. That is a real limitation, it is
 * the one the data supports today, and the UI says so rather than implying a
 * projection. Giving a price a billing period is its own piece of work.
 *
 * ── "Committed" includes pending, which the costs page does NOT ─────────────
 *
 * `costs.ts` counts `provisioning` and `completed`: what was actually built.
 * That is the right question for a spend report and the wrong one for a gate.
 * An approval queue full of `pending` orders would each see budget left,
 * because none of them has been built yet, and then collectively blow it the
 * moment they are approved. So a budget check counts what has been asked for
 * as well as what exists.
 */
export const COMMITTED_STATUSES = ['pending', 'provisioning', 'completed'] as const

/*
 * The wire types live in `@infrashelf/types` and are re-exported here.
 *
 * The screen that sets a budget and the service that enforces it have to agree
 * on the shape to the field, so there is one declaration, in the package both
 * sides already depend on. The re-export is for the backend callers that
 * import them from this module.
 */
export type { BudgetPeriod, BudgetBehaviour, BudgetState } from '@infrashelf/types'
import type { BudgetState, SetCostCentreBudgetRequest } from '@infrashelf/types'

/** The first moment of the current calendar month, in UTC. */
const startOfMonthUtc = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

/**
 * Convert through EUR, which is the rate base `exchange_rates` stores against.
 *
 * Returns null when either leg is missing, so the caller can report the amount
 * as unconverted instead of folding a wrong number into a gate.
 */
const convert = (
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number | null => {
  if (from === to) return amount
  const eur = from === 'EUR' ? amount : rates[from] ? amount / rates[from] : null
  if (eur === null) return null
  if (to === 'EUR') return eur
  const rate = rates[to]
  return rate ? eur * rate : null
}

const round = (value: number): number => Math.round(value * 100) / 100

/**
 * The budget state of one cost centre.
 *
 * Attribution follows `costs.ts` exactly rather than reinventing it: an order
 * counts against its OWN `cost_center_id` where it has one ('select' and
 * 'overhead' modes), and against its project's in the default 'project' mode,
 * where the order deliberately stores none. A check that read only
 * `orders.cost_center_id` would ignore most orders in a normal catalogue.
 */
export const loadBudgetState = async (costCenterId: number, now = new Date()): Promise<BudgetState | null> => {
  const [centre] = await db
    .select({
      id: costCenters.id,
      code: costCenters.code,
      name: costCenters.name,
      amount: costCenters.budgetAmount,
      currency: costCenters.budgetCurrency,
      period: costCenters.budgetPeriod,
      behaviour: costCenters.budgetBehaviour,
    })
    .from(costCenters)
    .where(eq(costCenters.id, costCenterId))
    .limit(1)

  if (!centre) return null

  const label = `${centre.code} — ${centre.name}`
  const amount = centre.amount === null ? null : Number(centre.amount)
  const currency = centre.currency

  if (amount === null || currency === null || centre.period === null || centre.behaviour === null) {
    return {
      costCenterId: centre.id, costCenterLabel: label,
      amount: null, currency: null, period: null, behaviour: null,
      committed: 0, remaining: 0, exhausted: false, unconverted: [],
    }
  }

  const projectCostCentres = alias(costCenters, 'budget_project_cost_centers')
  const conditions = [
    inArray(orders.status, [...COMMITTED_STATUSES]),
    // The `costs.ts` fall-through, as one predicate: the order's own cost centre,
    // or — only when it has none — its project's.
    or(
      eq(orders.costCenterId, costCenterId),
      and(isNull(orders.costCenterId), eq(projects.costCenterId, costCenterId)),
    ),
  ]
  if (centre.period === 'monthly') conditions.push(gte(orders.createdAt, startOfMonthUtc(now)))

  const rows = await db
    .select({
      /*
       * The snapshot is what the customer was actually charged (#38); the live
       * offering is the fallback for orders that predate snapshots. Same
       * resolution as `costs.ts`, through the same shared SQL as the cart, so a
       * budget cannot disagree with the cost report about what an order cost.
       */
      snapshotPrice: sql<string | null>`${orders.productSnapshot} ->> 'price'`,
      snapshotCurrency: sql<string | null>`${orders.productSnapshot} ->> 'currency'`,
      livePrice: linePriceSql(orders.productId, orders.environmentId, orders.sizeCode),
      liveCurrency: lineCurrencySql(orders.productId, orders.environmentId, orders.sizeCode),
      quantity: orders.quantity,
    })
    .from(orders)
    .innerJoin(projects, eq(projects.id, orders.projectId))
    .leftJoin(projectCostCentres, eq(projectCostCentres.id, projects.costCenterId))
    // Left, for the same reason the cost report uses one: an offering withdrawn
    // since the order was placed must not drop the order out of the sum, or
    // committed spend would fall when a product is retired.
    .leftJoin(
      productEnvironments,
      and(
        eq(orders.productId, productEnvironments.productId),
        eq(orders.environmentId, productEnvironments.environmentId),
      ),
    )
    .where(and(...conditions))

  const rateRows = await db
    .select({ code: exchangeRates.currencyCode, rate: exchangeRates.rate })
    .from(exchangeRates)
  const rates = Object.fromEntries(rateRows.map((r) => [r.code, parseFloat(r.rate)]))

  let committed = 0
  const unconverted = new Map<string, number>()
  for (const row of rows) {
    const usingSnapshot = row.snapshotPrice !== null && row.snapshotCurrency !== null
    const rawPrice = usingSnapshot ? row.snapshotPrice : row.livePrice
    const from = (usingSnapshot ? row.snapshotCurrency : row.liveCurrency) ?? 'EUR'
    // `null` is not `'0'`: an order whose offering has been withdrawn and which
    // predates snapshots is UNPRICED, and counting it as free would quietly give
    // budget back (#189).
    if (rawPrice === null || rawPrice === undefined) continue
    const line = Number(rawPrice) * (row.quantity ?? 1)
    const converted = convert(line, from, currency, rates)
    if (converted === null) {
      unconverted.set(from, (unconverted.get(from) ?? 0) + line)
      continue
    }
    committed += converted
  }

  committed = round(committed)
  return {
    costCenterId: centre.id,
    costCenterLabel: label,
    amount,
    currency,
    period: centre.period,
    behaviour: centre.behaviour,
    committed,
    remaining: round(amount - committed),
    exhausted: committed >= amount,
    unconverted: [...unconverted].map(([c, a]) => ({ currency: c, amount: round(a) })),
  }
}

/**
 * Every cost centre's budget state, for the administration screen.
 *
 * One request rather than one per row, so the screen can say at a glance which
 * cost centres have a budget and how much of it is gone.
 *
 * Sequential on purpose, and cheap in the case that matters: `loadBudgetState`
 * returns early for a centre with no budget, so a budget-less centre costs a
 * single primary-key select. Only centres that actually have a budget pay for
 * the order aggregate, and budgets are opt-in. If that stops being true this is
 * the place to write one grouped query instead — it is not worth the complexity
 * before then.
 */
export const loadAllBudgetStates = async (now = new Date()): Promise<BudgetState[]> => {
  const centres = await db.select({ id: costCenters.id }).from(costCenters).orderBy(costCenters.code)
  const states: BudgetState[] = []
  for (const centre of centres) {
    const state = await loadBudgetState(centre.id, now)
    // Only null if the centre vanished between the two queries; skipping beats
    // inventing a row for something that is no longer there.
    if (state) states.push(state)
  }
  return states
}

/**
 * Attach each row's cost-centre budget, for a list an approver reads (#325).
 *
 * Shared between the approvals queue and the pending-orders list because those
 * are two routes to the same screen, and a budget that appeared on one of them
 * only would be a notice that shows up depending on which endpoint the page
 * happens to call that week.
 *
 * `projectCostCenterId` is a lookup INPUT and is stripped from the result: an
 * order in the default 'project' mode stores no cost centre of its own, so the
 * fall-through has to happen here, and leaving the raw column on the row would
 * invite a client to read it instead of `budget` and reintroduce exactly the
 * attribution bug this exists to avoid.
 *
 * One lookup per DISTINCT cost centre, not per row: a queue of thirty orders
 * against three centres is three aggregates, and the answer cannot differ
 * between two rows billed to the same place.
 */
export const attachBudgets = async <
  T extends { costCenterId: number | null; projectCostCenterId: number | null },
>(
  rows: T[],
  now = new Date(),
): Promise<(Omit<T, 'projectCostCenterId'> & { budget: BudgetState | null })[]> => {
  const effective = (row: Pick<T, 'costCenterId' | 'projectCostCenterId'>) =>
    row.costCenterId ?? row.projectCostCenterId

  const distinct = [...new Set(rows.map(effective).filter((id): id is number => id !== null))]
  const states = new Map<number, BudgetState>()
  for (const id of distinct) {
    const state = await loadBudgetState(id, now)
    // Only a budget that exists goes on a row. `amount === null` is a cost centre
    // with no limit, and a row saying so would be noise on every order.
    if (state && state.amount !== null) states.set(id, state)
  }

  return rows.map((row) => {
    const { projectCostCenterId, ...rest } = row
    return {
      ...(rest as Omit<T, 'projectCostCenterId'>),
      budget: states.get(effective({ costCenterId: row.costCenterId, projectCostCenterId }) ?? -1) ?? null,
    }
  })
}

export interface BudgetVerdict {
  /** 'ok' when there is no budget, or room left. */
  outcome: 'ok' | 'warn' | 'block'
  state: BudgetState | null
  /** Human-readable, and the text the refusal or the warning shows. */
  message: string | null
}

/**
 * Whether an order may be placed against a cost centre, and what to say.
 *
 * `null` for the cost centre — an order whose project has none either — is 'ok':
 * a budget that nobody set cannot refuse anything, and refusing here would block
 * every order in an estate that has not adopted budgets at all.
 */
export const checkBudget = async (
  costCenterId: number | null,
  now = new Date(),
): Promise<BudgetVerdict> => {
  if (costCenterId === null) return { outcome: 'ok', state: null, message: null }

  const state = await loadBudgetState(costCenterId, now)
  if (!state || state.amount === null) return { outcome: 'ok', state, message: null }
  if (!state.exhausted) return { outcome: 'ok', state, message: null }

  const window = state.period === 'monthly' ? 'this month' : 'in total'
  const spent = `${state.committed.toFixed(2)} ${state.currency} of ${state.amount.toFixed(2)} ${state.currency}`
  const message =
    state.behaviour === 'block'
      ? `${state.costCenterLabel} is over budget: ${spent} committed ${window}. This order was not placed.`
      : `${state.costCenterLabel} is over budget: ${spent} committed ${window}.`

  return { outcome: state.behaviour === 'block' ? 'block' : 'warn', state, message }
}

/**
 * The budget verdict for an order that is about to be placed.
 *
 * Resolves the cost centre the way `costs.ts` attributes one: the order's own
 * where it has one, its project's otherwise. Callers pass what the order will
 * carry, not what they think it will count against, so the gate and the report
 * cannot disagree.
 */
export const checkBudgetForOrder = async (
  projectId: number,
  orderCostCenterId: number | null,
  now = new Date(),
): Promise<BudgetVerdict> => {
  if (orderCostCenterId !== null) return checkBudget(orderCostCenterId, now)

  const [project] = await db
    .select({ costCenterId: projects.costCenterId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  return checkBudget(project?.costCenterId ?? null, now)
}

export type BudgetInput = SetCostCentreBudgetRequest

/**
 * Set or clear a cost centre's budget (#325).
 *
 * `null` clears it, and clears all four columns together — the database CHECK
 * requires that, and so does the enforcement path, which would otherwise have
 * an amount with no behaviour to apply.
 *
 * Root-level rather than riding on `updateCostCenter`: an admin may rename a
 * cost centre and an admin may not decide what the platform refuses.
 */
export const setCostCentreBudget = async (
  costCenterId: number,
  budget: BudgetInput | null,
  actorId: number,
): Promise<Result<BudgetState>> => {
  const [updated] = await db
    .update(costCenters)
    .set(
      budget === null
        ? { budgetAmount: null, budgetCurrency: null, budgetPeriod: null, budgetBehaviour: null }
        : {
            budgetAmount: budget.amount.toFixed(2),
            budgetCurrency: budget.currency,
            budgetPeriod: budget.period,
            budgetBehaviour: budget.behaviour,
          },
    )
    .where(eq(costCenters.id, costCenterId))
    .returning({ id: costCenters.id })

  if (!updated) return err(404, 'Not found')

  await logAudit(
    actorId,
    budget === null ? 'cost_center.budget_cleared' : 'cost_center.budget_set',
    costCenterId,
    budget === null
      ? 'Budget removed'
      : `Budget set to ${budget.amount.toFixed(2)} ${budget.currency} per ${budget.period}, ${budget.behaviour} when spent`,
  )

  // The state rather than the row: whoever just set a budget wants to know what
  // is already committed against it, which is the number that decides whether
  // they have just blocked every order in flight.
  const state = await loadBudgetState(costCenterId)
  return state ? ok(state) : err(404, 'Not found')
}
