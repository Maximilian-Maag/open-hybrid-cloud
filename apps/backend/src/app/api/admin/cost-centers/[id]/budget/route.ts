import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { loadBudgetState, setCostCentreBudget } from '@/lib/services/budgets'

/**
 * A cost centre's budget (#325).
 *
 * `requireRole('root')` on all three verbs, and deliberately not riding on the
 * existing cost-centre write, which is `admin`. Renaming a cost centre and
 * deciding what the platform refuses to provision are different powers.
 *
 * GET returns the STATE, not the stored row: the committed figure is the one
 * that says whether a budget about to be set has already been spent, and it is
 * what the screen needs to show beside the amount.
 */
const BudgetSchema = z.object({
  amount: z.number().min(0),
  /*
   * Upper-cased and shape-checked, not merely three characters long.
   *
   * `exchange_rates.currency_code` is upper-case ISO-4217, and `convert` does an
   * exact lookup. So a budget stored as `eur` matches no rate: every order in a
   * different currency lands as "unconvertible", `committed` stays at zero, and
   * a `block` budget silently stops blocking. The screen already uppercases —
   * this is the same rule at the boundary that actually enforces it, because the
   * screen is not the only caller.
   *
   * Deliberately NOT "must already exist in exchange_rates". A budget in a
   * currency with no stored rate is legitimate as long as the spend is in that
   * same currency — `convert` short-circuits when the two match — and refusing
   * it would reject a working configuration to guard against a different one.
   * The unconvertible case is handled where it actually bites, in `checkBudget`,
   * which now fails closed and names the missing rate.
   */
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.string().regex(/^[A-Z]{3}$/, 'Expected a three-letter currency code, such as EUR')),
  period: z.enum(['total', 'monthly']),
  behaviour: z.enum(['warn', 'block']),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const costCenterId = parseRouteId(id)
  if (costCenterId === null) return invalidId('cost centre id')

  const state = await loadBudgetState(costCenterId)
  if (!state) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(state)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const costCenterId = parseRouteId(id)
  if (costCenterId === null) return invalidId('cost centre id')

  const body = await req.json().catch(() => null)
  const parsed = BudgetSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  return toResponse(await setCostCentreBudget(costCenterId, parsed.data, session.id))
}

/** Remove the budget. The cost centre stops refusing anything. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const costCenterId = parseRouteId(id)
  if (costCenterId === null) return invalidId('cost centre id')

  return toResponse(await setCostCentreBudget(costCenterId, null, session.id))
}
