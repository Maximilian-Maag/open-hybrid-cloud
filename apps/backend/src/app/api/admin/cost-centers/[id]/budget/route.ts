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
  currency: z.string().length(3),
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
