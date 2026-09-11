import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { GET } from './route'
import { createUser, makeAuthHeader, createCostCenter } from '@/test/helpers'
import { db } from '@/lib/db/client'
import { costCenters } from '@/lib/db/schema'
import type { BudgetState } from '@infrashelf/types'

/**
 * Every cost centre's budget in one request, for the administration screen.
 *
 * Guarded as `root` like the per-centre routes and unlike the cost-centre list
 * beside it, which is `admin`: a budget is a spending limit, and who may see one
 * is the same question as who may set it.
 */
const makeReq = (auth?: string) =>
  new NextRequest('http://localhost/api/admin/cost-centers/budgets', {
    headers: { ...(auth ? { authorization: auth } : {}) },
  })

describe('the guard is root, not admin', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await GET(makeReq())).status).toBe(401)
  })

  it('refuses an admin, who reads the cost-centre list but not its budgets', async () => {
    const admin = await createUser({ role: 'admin' })
    expect((await GET(makeReq(await makeAuthHeader(admin)))).status).toBe(403)
  })

  it('allows root', async () => {
    const root = await createUser({ role: 'root' })
    expect((await GET(makeReq(await makeAuthHeader(root)))).status).toBe(200)
  })
})

describe('what comes back', () => {
  it('carries a state for every cost centre, budget or not', async () => {
    // The screen renders a row per cost centre and decides per row whether to
    // show a badge. A centre missing from the answer would be indistinguishable
    // from one whose budget failed to load.
    const root = await createUser({ role: 'root' })
    const withBudget = await createCostCenter()
    const without = await createCostCenter()
    await db.update(costCenters).set({
      budgetAmount: '750.00', budgetCurrency: 'EUR', budgetPeriod: 'monthly', budgetBehaviour: 'warn',
    }).where(eq(costCenters.id, withBudget.id))

    const res = await GET(makeReq(await makeAuthHeader(root)))
    expect(res.status).toBe(200)
    const body = (await res.json()) as BudgetState[]

    const set = body.find((b) => b.costCenterId === withBudget.id)
    expect(set?.amount).toBe(750)
    expect(set?.currency).toBe('EUR')
    expect(set?.period).toBe('monthly')
    expect(set?.behaviour).toBe('warn')

    // Present, and honest about having no budget — not omitted.
    const unset = body.find((b) => b.costCenterId === without.id)
    expect(unset).toBeDefined()
    expect(unset?.amount).toBeNull()
  })

  it('carries the committed figure, not only the limit', async () => {
    // What the operator came for is how much of the budget is gone; the limit
    // alone just repeats what they set.
    const root = await createUser({ role: 'root' })
    const cc = await createCostCenter()
    await db.update(costCenters).set({
      budgetAmount: '900.00', budgetCurrency: 'EUR', budgetPeriod: 'total', budgetBehaviour: 'block',
    }).where(eq(costCenters.id, cc.id))

    const res = await GET(makeReq(await makeAuthHeader(root)))
    const body = (await res.json()) as BudgetState[]
    const state = body.find((b) => b.costCenterId === cc.id)

    expect(state?.committed).toBe(0)
    expect(state?.remaining).toBe(900)
    expect(state?.exhausted).toBe(false)
    expect(state?.costCenterLabel).toContain(cc.code)
  })
})
