import { describe, it, expect } from 'vitest'
import type { SessionUser } from '@open-hybrid-cloud/types'
import {
  listDelegations,
  createDelegation,
  revokeDelegation,
  activeDelegationsHeldBy,
  substitutionsByEmail,
} from './delegations'
import { db } from '@/lib/db/client'
import { approvalDelegations, auditLog } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createUser, createDelegation as seedDelegation } from '@/test/helpers'

const session = (u: { id: number; email: string; name: string; role: string }): SessionUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role as SessionUser['role'],
})

/** ISO date `offset` days from today, matching what the service compares against. */
const day = (offset: number): string => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

const admins = async () => {
  const alice = await createUser({ role: 'admin', email: 'alice@test.dev', name: 'Alice Admin' })
  const bob = await createUser({ role: 'admin', email: 'bob@test.dev', name: 'Bob Admin' })
  const carol = await createUser({ role: 'admin', email: 'carol@test.dev', name: 'Carol Admin' })
  return { alice, bob, carol }
}

describe('createDelegation', () => {
  it('records the period the admin asked for and audits the grant', async () => {
    const { alice, bob } = await admins()

    const result = await createDelegation(session(alice), {
      toUserId: bob.id,
      startsOn: day(1),
      endsOn: day(8),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toMatchObject({
      fromUserId: alice.id,
      toUserId: bob.id,
      toUserName: 'Bob Admin',
      startsOn: day(1),
      endsOn: day(8),
      // Starts tomorrow, so it is NOT in force yet — and that is a read-time
      // comparison, not a stored flag.
      active: false,
    })

    const entries = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'approval_delegation.created'))
    expect(entries).toHaveLength(1)
    expect(entries[0].userId).toBe(alice.id)
    expect(entries[0].entityId).toBe(result.data.id)
    expect(entries[0].details).toContain('alice@test.dev')
    expect(entries[0].details).toContain('bob@test.dev')
  })

  it('writes that entry on the transaction rather than through the pool', async () => {
    // Issue #188. The transaction holds FOR UPDATE on both users, and an audit_log
    // insert takes a FOR KEY SHARE lock on the user it names, so the entry could
    // not be written on a second connection: the pool query waited for a lock the
    // transaction held, and the transaction waited for that query to return. The
    // explicit timeout is the assertion — a regression hangs rather than fails.
    const { alice, bob } = await admins()
    const result = await createDelegation(session(alice), {
      toUserId: bob.id,
      startsOn: day(1),
      endsOn: day(2),
    })
    expect(result.ok).toBe(true)
    expect(
      await db.select().from(auditLog).where(eq(auditLog.action, 'approval_delegation.created')),
    ).toHaveLength(1)
  }, 8000)

  it('is active from the first day of the period', async () => {
    const { alice, bob } = await admins()
    const result = await createDelegation(session(alice), {
      toUserId: bob.id,
      startsOn: day(0),
      endsOn: day(0),
    })
    expect(result.ok && result.data.active).toBe(true)
  })

  it('refuses to delegate to yourself', async () => {
    const { alice } = await admins()
    const result = await createDelegation(session(alice), {
      toUserId: alice.id,
      startsOn: day(0),
      endsOn: day(1),
    })
    expect(result).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses a substitute who is not an active admin', async () => {
    const { alice } = await admins()
    const pm = await createUser({ role: 'project_manager' })
    const retired = await createUser({ role: 'admin', active: false })

    expect(
      await createDelegation(session(alice), { toUserId: pm.id, startsOn: day(0), endsOn: day(1) }),
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await createDelegation(session(alice), {
        toUserId: retired.id,
        startsOn: day(0),
        endsOn: day(1),
      }),
    ).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses an unknown substitute with 404', async () => {
    const { alice } = await admins()
    expect(
      await createDelegation(session(alice), {
        toUserId: 999999,
        startsOn: day(0),
        endsOn: day(1),
      }),
    ).toMatchObject({ ok: false, status: 404 })
  })

  it('keeps root out of the approval workflow on both sides', async () => {
    const { alice, bob } = await admins()
    const root = await createUser({ role: 'root', email: 'root@test.dev', name: 'Root' })

    // Root cannot delegate.
    expect(
      await createDelegation(session(root), { toUserId: bob.id, startsOn: day(0), endsOn: day(1) }),
    ).toMatchObject({ ok: false, status: 403 })
    // Root cannot be nominated: it is not role 'admin'.
    expect(
      await createDelegation(session(alice), {
        toUserId: root.id,
        startsOn: day(0),
        endsOn: day(1),
      }),
    ).toMatchObject({ ok: false, status: 400 })
  })

  it('rejects a period that is not two real calendar dates in order', async () => {
    const { alice, bob } = await admins()
    for (const period of [
      { startsOn: '2026-13-01', endsOn: day(5) },
      { startsOn: '2026-02-30', endsOn: day(5) },
      { startsOn: 'tomorrow', endsOn: day(5) },
      { startsOn: day(5), endsOn: day(1) },
    ]) {
      expect(
        await createDelegation(session(alice), { toUserId: bob.id, ...period }),
        JSON.stringify(period),
      ).toMatchObject({ ok: false, status: 400 })
    }
  })

  it('refuses to backdate a delegation', async () => {
    const { alice, bob } = await admins()
    // Authority that began before it was granted would claim decisions already
    // taken, which is exactly what the audit trail has to make impossible.
    expect(
      await createDelegation(session(alice), {
        toUserId: bob.id,
        startsOn: day(-1),
        endsOn: day(5),
      }),
    ).toMatchObject({ ok: false, status: 400 })
  })

  it('allows a single day', async () => {
    const { alice, bob } = await admins()
    expect(
      (await createDelegation(session(alice), {
        toUserId: bob.id,
        startsOn: day(3),
        endsOn: day(3),
      })).ok,
    ).toBe(true)
  })
})

describe('createDelegation — one live delegation per admin', () => {
  it('refuses a second delegation overlapping the first', async () => {
    const { alice, bob, carol } = await admins()
    await createDelegation(session(alice), { toUserId: bob.id, startsOn: day(1), endsOn: day(10) })

    const overlapping = await createDelegation(session(alice), {
      toUserId: carol.id,
      startsOn: day(5),
      endsOn: day(15),
    })
    expect(overlapping).toMatchObject({ ok: false, status: 409 })
  })

  it('refuses two FUTURE delegations that would both become live', async () => {
    const { alice, bob, carol } = await admins()
    await createDelegation(session(alice), { toUserId: bob.id, startsOn: day(10), endsOn: day(20) })
    // Neither is in force today, so a "one ACTIVE delegation" check evaluated
    // against today would let both through and the rule would break tomorrow.
    expect(
      await createDelegation(session(alice), {
        toUserId: carol.id,
        startsOn: day(15),
        endsOn: day(25),
      }),
    ).toMatchObject({ ok: false, status: 409 })
  })

  it('allows a second delegation once the first is over', async () => {
    const { alice, bob, carol } = await admins()
    await createDelegation(session(alice), { toUserId: bob.id, startsOn: day(1), endsOn: day(5) })
    expect(
      (await createDelegation(session(alice), {
        toUserId: carol.id,
        startsOn: day(6),
        endsOn: day(10),
      })).ok,
    ).toBe(true)
  })

  it('frees the period again after a revoke', async () => {
    const { alice, bob, carol } = await admins()
    const first = await createDelegation(session(alice), {
      toUserId: bob.id,
      startsOn: day(1),
      endsOn: day(10),
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    await revokeDelegation(session(alice), first.data.id)
    expect(
      (await createDelegation(session(alice), {
        toUserId: carol.id,
        startsOn: day(1),
        endsOn: day(10),
      })).ok,
    ).toBe(true)
  })
})

describe('createDelegation — no chains', () => {
  it('refuses A→B while B→C would already exist (B cannot delegate what it holds)', async () => {
    const { alice, bob, carol } = await admins()
    // Alice hands her authority to Bob.
    await createDelegation(session(alice), { toUserId: bob.id, startsOn: day(1), endsOn: day(10) })
    // Bob must not pass anything on — Carol would end up holding Alice's
    // authority, which Alice never granted her.
    expect(
      await createDelegation(session(bob), {
        toUserId: carol.id,
        startsOn: day(2),
        endsOn: day(4),
      }),
    ).toMatchObject({ ok: false, status: 409 })
  })

  it('refuses the same chain assembled in the other order', async () => {
    const { alice, bob, carol } = await admins()
    // Bob delegates away first...
    await createDelegation(session(bob), { toUserId: carol.id, startsOn: day(1), endsOn: day(10) })
    // ...so Bob is not available as Alice's substitute over that period.
    expect(
      await createDelegation(session(alice), {
        toUserId: bob.id,
        startsOn: day(3),
        endsOn: day(6),
      }),
    ).toMatchObject({ ok: false, status: 409 })
  })

  it('allows the same pair once the periods do not overlap', async () => {
    const { alice, bob, carol } = await admins()
    await createDelegation(session(alice), { toUserId: bob.id, startsOn: day(1), endsOn: day(5) })
    expect(
      (await createDelegation(session(bob), {
        toUserId: carol.id,
        startsOn: day(6),
        endsOn: day(10),
      })).ok,
    ).toBe(true)
  })

  it('allows fan-in: one substitute covering two absent admins', async () => {
    const { alice, bob, carol } = await admins()
    await createDelegation(session(alice), { toUserId: carol.id, startsOn: day(0), endsOn: day(5) })
    expect(
      (await createDelegation(session(bob), {
        toUserId: carol.id,
        startsOn: day(0),
        endsOn: day(5),
      })).ok,
    ).toBe(true)

    const held = await activeDelegationsHeldBy(carol.id)
    expect(held.map((d) => d.fromUserEmail).sort()).toEqual(['alice@test.dev', 'bob@test.dev'])
  })
})

describe('activeDelegationsHeldBy — expiry by date comparison', () => {
  it('ignores a delegation whose end date has passed, with no job having run', async () => {
    const { alice, bob } = await admins()
    await seedDelegation(alice.id, bob.id, { startsInDays: -10, endsInDays: -1 })
    expect(await activeDelegationsHeldBy(bob.id)).toEqual([])
  })

  it('is in force on the end date itself', async () => {
    const { alice, bob } = await admins()
    await seedDelegation(alice.id, bob.id, { startsInDays: -3, endsInDays: 0 })
    expect(await activeDelegationsHeldBy(bob.id)).toHaveLength(1)
  })

  it('ignores a delegation that has not started yet', async () => {
    const { alice, bob } = await admins()
    await seedDelegation(alice.id, bob.id, { startsInDays: 1, endsInDays: 5 })
    expect(await activeDelegationsHeldBy(bob.id)).toEqual([])
  })

  it('ignores a revoked delegation even inside its period', async () => {
    const { alice, bob } = await admins()
    await seedDelegation(alice.id, bob.id, {
      startsInDays: -1,
      endsInDays: 5,
      revokedAt: new Date(),
    })
    expect(await activeDelegationsHeldBy(bob.id)).toEqual([])
  })

  it('looks only at authority HELD, not authority given away', async () => {
    const { alice, bob } = await admins()
    await seedDelegation(alice.id, bob.id, { startsInDays: 0, endsInDays: 3 })
    expect(await activeDelegationsHeldBy(alice.id)).toEqual([])
    expect(await activeDelegationsHeldBy(bob.id)).toHaveLength(1)
  })
})

describe('substitutionsByEmail', () => {
  it('maps a substitute address to the names they are covering for', async () => {
    const { alice, bob, carol } = await admins()
    await seedDelegation(alice.id, carol.id, { startsInDays: 0, endsInDays: 2 })
    await seedDelegation(bob.id, carol.id, { startsInDays: 0, endsInDays: 2 })

    const map = await substitutionsByEmail()
    expect(map.get('carol@test.dev')?.sort()).toEqual(['Alice Admin', 'Bob Admin'])
    expect(map.get('alice@test.dev')).toBeUndefined()
  })

  it('leaves an expired delegation out of the email annotation', async () => {
    const { alice, bob } = await admins()
    await seedDelegation(alice.id, bob.id, { startsInDays: -5, endsInDays: -2 })
    expect((await substitutionsByEmail()).size).toBe(0)
  })
})

describe('listDelegations', () => {
  it('refuses root, which does not participate and must not enumerate admins', async () => {
    // The route gates on requireRole('admin'), which admits root by rank, so the
    // service is where this has to hold — otherwise the one role excluded from
    // the workflow could still read the full candidate roster.
    const root = await createUser({ role: 'root' })
    const result = await listDelegations(session(root))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('separates authority given away from authority held', async () => {
    const { alice, bob, carol } = await admins()
    await seedDelegation(alice.id, bob.id, { startsInDays: 0, endsInDays: 3 })
    await seedDelegation(carol.id, alice.id, { startsInDays: 0, endsInDays: 3 })

    const result = await listDelegations(session(alice))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.mine.map((d) => d.toUserEmail)).toEqual(['bob@test.dev'])
    expect(result.data.grantedToMe.map((d) => d.fromUserEmail)).toEqual(['carol@test.dev'])
    expect(result.data.mine[0].active).toBe(true)
  })

  it('offers the other active admins as substitutes, and nobody else', async () => {
    const { alice, bob } = await admins()
    await createUser({ role: 'root', email: 'root@test.dev' })
    await createUser({ role: 'project_manager', email: 'pm@test.dev' })
    await createUser({ role: 'admin', email: 'retired@test.dev', active: false })

    const result = await listDelegations(session(alice))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const emails = result.data.candidates.map((c) => c.email).sort()
    expect(emails).toEqual(['bob@test.dev', 'carol@test.dev'])
    expect(emails).not.toContain('alice@test.dev')
    void bob
  })

  it('still returns a revoked delegation, so the audit trail keeps resolving', async () => {
    const { alice, bob } = await admins()
    await seedDelegation(alice.id, bob.id, { startsInDays: 0, endsInDays: 3, revokedAt: new Date() })

    const result = await listDelegations(session(alice))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.mine).toHaveLength(1)
    expect(result.data.mine[0].revokedAt).not.toBeNull()
    expect(result.data.mine[0].active).toBe(false)
  })
})

describe('revokeDelegation', () => {
  it('revokes exactly once when two requests race, and audits once', async () => {
    // The SELECT and the UPDATE are separate statements, so both callers can see
    // an unrevoked row. The isNull guard already stopped the second WRITE — but
    // without reading the row count the loser still logged a revoke it did not
    // perform and answered 200 for it.
    const { alice, bob } = await admins()
    const seeded = await seedDelegation(alice.id, bob.id, { startsInDays: 0, endsInDays: 5 })

    const [a, b] = await Promise.all([
      revokeDelegation(session(alice), seeded.id),
      revokeDelegation(session(alice), seeded.id),
    ])

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)

    const entries = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'approval_delegation.revoked'))
    expect(entries).toHaveLength(1)
  })

  it('stamps the row instead of deleting it, and audits the revoke', async () => {
    const { alice, bob } = await admins()
    const seeded = await seedDelegation(alice.id, bob.id, { startsInDays: 0, endsInDays: 5 })

    expect((await revokeDelegation(session(alice), seeded.id)).ok).toBe(true)

    const [row] = await db
      .select()
      .from(approvalDelegations)
      .where(eq(approvalDelegations.id, seeded.id))
    expect(row.revokedAt).not.toBeNull()

    const entries = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'approval_delegation.revoked'))
    expect(entries).toHaveLength(1)
    expect(entries[0].entityId).toBe(seeded.id)
  })

  it('is the delegator’s call, not the substitute’s', async () => {
    const { alice, bob } = await admins()
    const seeded = await seedDelegation(alice.id, bob.id, { startsInDays: 0, endsInDays: 5 })
    // Bob declining is a conversation with Alice; letting him clear it would
    // leave Alice believing she is covered.
    expect(await revokeDelegation(session(bob), seeded.id)).toMatchObject({
      ok: false,
      status: 403,
    })
  })

  it('returns 404 for an unknown delegation and 400 for one already revoked', async () => {
    const { alice, bob } = await admins()
    const seeded = await seedDelegation(alice.id, bob.id, {
      startsInDays: 0,
      endsInDays: 5,
      revokedAt: new Date(),
    })
    expect(await revokeDelegation(session(alice), 999999)).toMatchObject({ ok: false, status: 404 })
    expect(await revokeDelegation(session(alice), seeded.id)).toMatchObject({
      ok: false,
      status: 400,
    })
  })
})
