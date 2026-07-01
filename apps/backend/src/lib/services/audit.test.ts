import { describe, it, expect } from 'vitest'
import { listAuditLog, exportAuditLog } from './audit'
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
})
