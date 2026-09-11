import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { GET, PUT, DELETE } from './route'
import { createUser, makeAuthHeader, createCostCenter } from '@/test/helpers'
import { db } from '@/lib/db/client'
import { costCenters, auditLog } from '@/lib/db/schema'

/**
 * A budget decides what the platform refuses to provision, so the guard here is
 * the point of the endpoint as much as the payload is.
 */
const makeReq = (id: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/cost-centers/${id}/budget`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  })

const params = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) })
const budget = { amount: 500, currency: 'EUR', period: 'total' as const, behaviour: 'block' as const }

describe('the guard is root, not admin', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await PUT(makeReq('1', 'PUT', budget), params(1))).status).toBe(401)
  })

  it('refuses an ADMIN, who may rename a cost centre but not decide what is refused', async () => {
    // The distinction this endpoint exists for: `updateCostCenter` is admin, and
    // riding on it would have handed every admin the power to stop provisioning.
    const admin = await createUser({ role: 'admin' })
    const cc = await createCostCenter()
    const res = await PUT(makeReq(String(cc.id), 'PUT', budget, await makeAuthHeader(admin)), params(cc.id))
    expect(res.status).toBe(403)
  })

  it('allows root', async () => {
    const root = await createUser({ role: 'root' })
    const cc = await createCostCenter()
    const res = await PUT(makeReq(String(cc.id), 'PUT', budget, await makeAuthHeader(root)), params(cc.id))
    expect(res.status).toBe(200)
  })
})

describe('the currency is normalised at the boundary', () => {
  /*
   * `exchange_rates.currency_code` is upper-case and `convert` looks it up
   * exactly, so a budget stored as `eur` matches no rate: every order in another
   * currency lands as unconvertible, `committed` stays at zero, and a `block`
   * budget silently stops blocking. The screen uppercases — the screen is not
   * the only caller.
   */
  it('stores a lower-case code upper-cased', async () => {
    const root = await createUser({ role: 'root' })
    const cc = await createCostCenter()
    const res = await PUT(
      makeReq(String(cc.id), 'PUT', { ...budget, currency: 'chf' }, await makeAuthHeader(root)),
      params(cc.id),
    )
    expect(res.status).toBe(200)

    const [row] = await db.select().from(costCenters).where(eq(costCenters.id, cc.id))
    expect(row.budgetCurrency).toBe('CHF')
  })

  it('trims surrounding whitespace', async () => {
    const root = await createUser({ role: 'root' })
    const cc = await createCostCenter()
    await PUT(
      makeReq(String(cc.id), 'PUT', { ...budget, currency: ' usd ' }, await makeAuthHeader(root)),
      params(cc.id),
    )
    const [row] = await db.select().from(costCenters).where(eq(costCenters.id, cc.id))
    expect(row.budgetCurrency).toBe('USD')
  })

  it('refuses a three-character value that is not a currency code', async () => {
    const root = await createUser({ role: 'root' })
    const cc = await createCostCenter()
    for (const currency of ['$$$', '1 2', 'e€r']) {
      const res = await PUT(
        makeReq(String(cc.id), 'PUT', { ...budget, currency }, await makeAuthHeader(root)),
        params(cc.id),
      )
      expect(res.status, `${currency} should be refused`).toBe(400)
    }
    const [row] = await db.select().from(costCenters).where(eq(costCenters.id, cc.id))
    expect(row.budgetCurrency).toBeNull()
  })

  it('still refuses the wrong length', async () => {
    const root = await createUser({ role: 'root' })
    const cc = await createCostCenter()
    for (const currency of ['EU', 'EURO', '']) {
      const res = await PUT(
        makeReq(String(cc.id), 'PUT', { ...budget, currency }, await makeAuthHeader(root)),
        params(cc.id),
      )
      expect(res.status, `${currency} should be refused`).toBe(400)
    }
  })
})

describe('setting a budget', () => {
  it('stores all four columns together', async () => {
    // The database CHECK requires it and the enforcement path depends on it: an
    // amount with no behaviour leaves the gate guessing.
    const root = await createUser({ role: 'root' })
    const cc = await createCostCenter()
    await PUT(makeReq(String(cc.id), 'PUT', budget, await makeAuthHeader(root)), params(cc.id))

    const [row] = await db.select().from(costCenters).where(eq(costCenters.id, cc.id))
    expect(row.budgetAmount).toBe('500.00')
    expect(row.budgetCurrency).toBe('EUR')
    expect(row.budgetPeriod).toBe('total')
    expect(row.budgetBehaviour).toBe('block')
  })

  it('answers with what is already committed, not just the amount', async () => {
    // Whoever just set a budget needs to know whether they have blocked every
    // order already in flight.
    const root = await createUser({ role: 'root' })
    const cc = await createCostCenter()
    const res = await PUT(makeReq(String(cc.id), 'PUT', budget, await makeAuthHeader(root)), params(cc.id))
    const body = await res.json()
    expect(body).toMatchObject({ amount: 500, currency: 'EUR', committed: 0, exhausted: false })
  })

  it('audits the change', async () => {
    const root = await createUser({ role: 'root' })
    const cc = await createCostCenter()
    await PUT(makeReq(String(cc.id), 'PUT', budget, await makeAuthHeader(root)), params(cc.id))

    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'cost_center.budget_set'))
    expect(rows.some((r) => r.entityId === cc.id)).toBe(true)
  })

  it.each([
    ['a negative amount', { ...budget, amount: -1 }],
    ['an unknown period', { ...budget, period: 'weekly' }],
    ['an unknown behaviour', { ...budget, behaviour: 'shout' }],
    ['a currency that is not a code', { ...budget, currency: 'EURO' }],
  ])('refuses %s', async (_label, payload) => {
    const root = await createUser({ role: 'root' })
    const cc = await createCostCenter()
    const res = await PUT(makeReq(String(cc.id), 'PUT', payload, await makeAuthHeader(root)), params(cc.id))
    expect(res.status).toBe(400)
  })

  it('is 404 for a cost centre that does not exist', async () => {
    const root = await createUser({ role: 'root' })
    const res = await PUT(makeReq('999999', 'PUT', budget, await makeAuthHeader(root)), params(999999))
    expect(res.status).toBe(404)
  })
})

describe('clearing a budget', () => {
  it('clears all four columns, so nothing is left half-configured', async () => {
    const root = await createUser({ role: 'root' })
    const cc = await createCostCenter()
    await PUT(makeReq(String(cc.id), 'PUT', budget, await makeAuthHeader(root)), params(cc.id))
    await DELETE(makeReq(String(cc.id), 'DELETE', undefined, await makeAuthHeader(root)), params(cc.id))

    const [row] = await db.select().from(costCenters).where(eq(costCenters.id, cc.id))
    expect(row.budgetAmount).toBeNull()
    expect(row.budgetCurrency).toBeNull()
    expect(row.budgetPeriod).toBeNull()
    expect(row.budgetBehaviour).toBeNull()
  })
})

describe('reading the state', () => {
  it('reports no budget as an amount of null rather than 404', async () => {
    // A cost centre without a budget is a normal cost centre, not a missing one.
    const root = await createUser({ role: 'root' })
    const cc = await createCostCenter()
    const res = await GET(makeReq(String(cc.id), 'GET', undefined, await makeAuthHeader(root)), params(cc.id))
    expect(res.status).toBe(200)
    expect((await res.json()).amount).toBeNull()
  })
})
