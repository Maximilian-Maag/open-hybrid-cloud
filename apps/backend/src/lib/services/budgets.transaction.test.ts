import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'

/**
 * Setting a budget and recording who set it are one operation (#325).
 *
 * In its own file because proving it needs the audit insert to FAIL, and that
 * means mocking the audit module — which would apply to every test in
 * `budgets.test.ts`, where the audit entries are the assertion.
 *
 * Without the transaction this is the combination that happened: the update
 * committed, the audit insert threw, the caller saw an error, and the budget was
 * changed with nothing saying who changed it. A control that can be altered
 * without a record is not auditable.
 */
const logAuditWith = vi.fn()
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
  logAuditWith: (...args: unknown[]) => logAuditWith(...args),
}))

import { setCostCentreBudget } from './budgets'
import { db } from '@/lib/db/client'
import { costCenters } from '@/lib/db/schema'
import { createUser, createCostCenter } from '@/test/helpers'

beforeEach(() => logAuditWith.mockReset().mockResolvedValue(undefined))

describe('the budget change and its audit entry are one transaction', () => {
  it('leaves the budget untouched when the audit entry cannot be written', async () => {
    logAuditWith.mockRejectedValueOnce(new Error('audit table is unavailable'))
    const actor = await createUser({ role: 'root' })
    const centre = await createCostCenter()

    await expect(
      setCostCentreBudget(
        centre.id,
        { amount: 400, currency: 'EUR', period: 'total', behaviour: 'block' },
        actor.id,
      ),
    ).rejects.toThrow(/audit/i)

    const [row] = await db.select().from(costCenters).where(eq(costCenters.id, centre.id))
    expect(row.budgetAmount).toBeNull()
    expect(row.budgetCurrency).toBeNull()
    expect(row.budgetPeriod).toBeNull()
    expect(row.budgetBehaviour).toBeNull()
  })

  it('leaves an existing budget in place when clearing it cannot be recorded', async () => {
    const actor = await createUser({ role: 'root' })
    const centre = await createCostCenter()
    await setCostCentreBudget(
      centre.id, { amount: 400, currency: 'EUR', period: 'total', behaviour: 'block' }, actor.id,
    )

    logAuditWith.mockRejectedValueOnce(new Error('audit table is unavailable'))
    await expect(setCostCentreBudget(centre.id, null, actor.id)).rejects.toThrow(/audit/i)

    const [row] = await db.select().from(costCenters).where(eq(costCenters.id, centre.id))
    expect(row.budgetAmount).toBe('400.00')
    expect(row.budgetBehaviour).toBe('block')
  })
})
