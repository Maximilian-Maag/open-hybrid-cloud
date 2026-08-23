import { describe, it, expect } from 'vitest'
import { listAuditLog, exportAuditLog, auditBoundary } from './audit'
import { db } from '@/lib/db/client'
import { auditLog } from '@/lib/db/schema'
import { createUser } from '@/test/helpers'

describe('listAuditLog', () => {
  it('returns rows joined with user name and total count', async () => {
    const u = await createUser({ name: 'Auditor' })
    await db.insert(auditLog).values([
      { userId: u.id, action: 'order.created', entityId: 1, details: 'x' },
      { userId: u.id, action: 'order.approved', entityId: 2, details: 'y' },
    ])

    const result = await listAuditLog({}, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.data.total).toBe(2)
    expect(result.data.rows.length).toBe(2)
    expect(result.data.rows[0].userName).toBe('Auditor')
  })

  it('filters by userId', async () => {
    const u1 = await createUser({ email: 'one@test.dev' })
    const u2 = await createUser({ email: 'two@test.dev' })
    await db.insert(auditLog).values([
      { userId: u1.id, action: 'a', entityId: 1, details: '' },
      { userId: u2.id, action: 'b', entityId: 2, details: '' },
    ])

    const result = await listAuditLog({ userId: u1.id }, 1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.total).toBe(1)
      expect(result.data.rows[0].userId).toBe(u1.id)
    }
  })

  it('filters by action with case-insensitive substring (ilike) match', async () => {
    const u = await createUser()
    await db.insert(auditLog).values([
      { userId: u.id, action: 'order.created', entityId: 1, details: '' },
      { userId: u.id, action: 'order.approved', entityId: 2, details: '' },
      { userId: u.id, action: 'infra.decommissioning', entityId: 3, details: '' },
    ])

    const result = await listAuditLog({ action: 'ORDER' }, 1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.total).toBe(2)
      const actions = result.data.rows.map((r) => r.action).sort()
      expect(actions).toEqual(['order.approved', 'order.created'])
    }
  })

  it('filters by from/to date range', async () => {
    const u = await createUser()
    const old = new Date('2020-01-01T00:00:00Z')
    const recent = new Date('2026-06-15T00:00:00Z')
    await db.insert(auditLog).values([
      { userId: u.id, action: 'old', entityId: 1, details: '', createdAt: old },
      { userId: u.id, action: 'recent', entityId: 2, details: '', createdAt: recent },
    ])

    const result = await listAuditLog({ from: '2026-01-01', to: '2026-12-31' }, 1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.total).toBe(1)
      expect(result.data.rows[0].action).toBe('recent')
    }
  })
})

describe('exportAuditLog', () => {
  it('returns all matching rows without pagination', async () => {
    const u = await createUser()
    const values = Array.from({ length: 75 }).map((_, i) => ({
      userId: u.id,
      action: `act-${i}`,
      entityId: i,
      details: '',
    }))
    await db.insert(auditLog).values(values)

    const result = await exportAuditLog({})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(75)
    }
  })

  it('applies filters', async () => {
    const u = await createUser()
    await db.insert(auditLog).values([
      { userId: u.id, action: 'order.created', entityId: 1, details: '' },
      { userId: u.id, action: 'infra.decommissioning', entityId: 2, details: '' },
    ])

    const result = await exportAuditLog({ action: 'order' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.length).toBe(1)
      expect(result.data[0].action).toBe('order.created')
    }
  })

  /*
   * The cap is exercised through the `maxRows` parameter rather than by writing
   * 50 001 rows: the boundary logic is the same at 3 as it is at 50 000, and the
   * fixture would otherwise dominate the suite's runtime for no extra coverage.
   *
   * What is under test is that going over the cap is REFUSED. It used to come back
   * as an ordinary attachment holding the oldest `maxRows` — a compliance export
   * that looked complete and was not.
   */
  const seedRows = async (n: number) => {
    const u = await createUser()
    await db.insert(auditLog).values(
      Array.from({ length: n }).map((_, i) => ({
        userId: u.id,
        action: `capped-${i}`,
        entityId: i,
        details: '',
      })),
    )
  }

  it('refuses an export that matches more rows than the cap', async () => {
    await seedRows(4)

    const result = await exportAuditLog({}, 3)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(413)
      expect(result.message).toContain('3')
      // The message has to say what to do about it, or the admin just retries.
      expect(result.message).toMatch(/from\/to/)
    }
  })

  it('serves an export that lands exactly on the cap', async () => {
    await seedRows(3)

    const result = await exportAuditLog({}, 3)
    expect(result.ok).toBe(true)
    // The extra row fetched to detect overflow must not reach the caller.
    if (result.ok) expect(result.data.length).toBe(3)
  })

  it('counts only the rows the filters match against the cap', async () => {
    const u = await createUser()
    await db.insert(auditLog).values([
      { userId: u.id, action: 'order.created', entityId: 1, details: '' },
      { userId: u.id, action: 'infra.a', entityId: 2, details: '' },
      { userId: u.id, action: 'infra.b', entityId: 3, details: '' },
      { userId: u.id, action: 'infra.c', entityId: 4, details: '' },
    ])

    // Four rows in the table, one matching: the filtered export is under the cap.
    const result = await exportAuditLog({ action: 'order' }, 2)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.length).toBe(1)
  })
})

describe('auditBoundary', () => {
  /*
   * `new Date('2026-02-30T00:00:00.000Z')` is March 2nd and `2026-13-01` is January
   * 2027 — `Date` normalises rather than rejects, so a `from` nobody could have
   * meant was accepted and answered 200 over the wrong range (issue #143).
   */
  it.each([
    '2026-02-30',
    '2026-02-29',
    '2026-04-31',
    '2026-06-31',
    '2026-09-31',
    '2026-11-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-01-32',
    '2026-02-30T12:00:00.000Z',
  ])('rejects %s, which names a day that does not exist', (raw) => {
    expect(auditBoundary(raw, 'start')).toBeNull()
    expect(auditBoundary(raw, 'end')).toBeNull()
  })

  it.each([
    ['2026-02-28', 'the real end of a common-year February'],
    ['2024-02-29', 'a leap day in a leap year'],
    ['2000-02-29', 'a leap day in a century divisible by 400'],
    ['2026-01-31', 'a 31-day month'],
    ['2026-04-30', 'a 30-day month'],
    ['2026-12-31T23:00:00.000Z', 'a full ISO timestamp'],
  ])('accepts %s (%s)', (raw) => {
    expect(auditBoundary(raw, 'start')).toBeInstanceOf(Date)
  })

  it('rejects 1900-02-29 — divisible by 4 and by 100 but not by 400', () => {
    expect(auditBoundary('1900-02-29', 'start')).toBeNull()
    expect(auditBoundary('1900-02-28', 'start')).toBeInstanceOf(Date)
  })

  it('widens a bare date to the whole named day', () => {
    expect(auditBoundary('2026-03-04', 'start')?.toISOString()).toBe('2026-03-04T00:00:00.000Z')
    expect(auditBoundary('2026-03-04', 'end')?.toISOString()).toBe('2026-03-04T23:59:59.999Z')
  })
})
