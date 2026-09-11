import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { loadAllBudgetStates } from '@/lib/services/budgets'

/**
 * Every cost centre's budget state (#325).
 *
 * `root`, matching the per-centre routes rather than the `admin` that reads the
 * cost-centre list. A budget is a spending limit, and who may see one is the
 * same question as who may set it.
 *
 * Sits at `/budgets` rather than under `[id]`, so it cannot collide with the
 * numeric-id routes: `parseRouteId` would reject "budgets" as an id anyway, but
 * a sibling segment says what this is without the reader having to check.
 */
export async function GET(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  return NextResponse.json(await loadAllBudgetStates())
}
