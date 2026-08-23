import type { SessionUser } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import { approvalDelegations, users } from '@/lib/db/schema'
import { and, eq, isNull, sql, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { logAudit } from '@/lib/audit'
import { ok, err, type Result } from '@/lib/services/result'

/**
 * Approval delegation — the out-of-office substitute approver (issue #35).
 *
 * ## What is delegated
 *
 * AUTHORITY, not identity. The substitute approves as themselves; `session.id` is
 * never swapped for the delegator's. That is not a detail — an implementation that
 * made the approval look like the delegator's would both falsify the audit log and
 * hand the substitute a way around "you may not approve your own order", because
 * the self-check would compare the delegator's id against the orderer's.
 *
 * This system has no per-admin approval queue: `listApprovals` returns every
 * pending order and any admin may act on it. A delegation therefore cannot move
 * rows between inboxes. What it does is
 *
 *   - name, on the approvals page, whose authority the viewer is currently
 *     holding, so a substitute knows the queue is theirs to clear;
 *   - annotate the approval-request email for the substitute;
 *   - and make every decision taken while it is in force resolvable in the audit
 *     log to both the actor and the authority.
 *
 * ## Expiry
 *
 * `starts_on <= today <= ends_on`, both ends inclusive, evaluated in SQL at read
 * time (`CURRENT_DATE`). There is no `active` column and no job: a delegation
 * cannot outlive its end date because nothing has to notice that it ended.
 *
 * ## Overlapping and chained delegations
 *
 * A user may not appear on BOTH sides of overlapping delegations. Concretely:
 *
 *   - one live delegation per delegator (the issue's "only one active delegation
 *     per admin at a time"), enforced against the whole period, not just today —
 *     otherwise two future delegations could both become live tomorrow;
 *   - a delegator may not currently hold somebody else's authority, and a
 *     substitute may not have given their own away. Together these make A→B
 *     while B→C impossible in either order, so authority never travels more than
 *     one hop from the admin who granted it. A chain is how someone ends up
 *     holding authority nobody granted them.
 *
 * Fan-in is allowed: B may hold delegations from both A and C at once. Each is
 * still one hop, each was granted deliberately, and covering two absent admins is
 * the whole point of the feature.
 *
 * ## Root
 *
 * Root does not participate in the approval workflow (issue #35), so root can be
 * neither delegator nor substitute. Note that `requireRole('admin')` admits root
 * by rank, so this is enforced here rather than at the route.
 */

/** A delegation as the API returns it. */
export interface DelegationRow {
  id: number
  fromUserId: number
  fromUserName: string
  fromUserEmail: string
  toUserId: number
  toUserName: string
  toUserEmail: string
  /** ISO calendar date, inclusive. */
  startsOn: string
  /** ISO calendar date, inclusive — the last day the delegation is in force. */
  endsOn: string
  createdAt: Date
  revokedAt: Date | null
  /** Computed by date comparison at read time; never stored. */
  active: boolean
}

/** An admin who may be nominated as a substitute. */
export interface DelegationCandidate {
  id: number
  name: string
  email: string
}

export interface DelegationsView {
  /** Delegations the caller has granted (their own authority, given away). */
  mine: DelegationRow[]
  /** Delegations granted TO the caller — the authority they are holding. */
  grantedToMe: DelegationRow[]
  /** Active admins the caller may nominate. */
  candidates: DelegationCandidate[]
}

export interface CreateDelegationInput {
  toUserId: number
  /** ISO calendar date (YYYY-MM-DD), inclusive. */
  startsOn: string
  /** ISO calendar date (YYYY-MM-DD), inclusive. */
  endsOn: string
}

/** The two ends of a delegation, both rows of `users`. */
const fromUser = alias(users, 'delegation_from_user')
const toUser = alias(users, 'delegation_to_user')

/** `true` when today falls inside the period and the row was not revoked. */
const ACTIVE_SQL = sql<boolean>`(
  ${approvalDelegations.revokedAt} IS NULL
  AND ${approvalDelegations.startsOn} <= CURRENT_DATE
  AND ${approvalDelegations.endsOn} >= CURRENT_DATE
)`

const DELEGATION_COLUMNS = {
  id: approvalDelegations.id,
  fromUserId: approvalDelegations.fromUserId,
  fromUserName: fromUser.name,
  fromUserEmail: fromUser.email,
  toUserId: approvalDelegations.toUserId,
  toUserName: toUser.name,
  toUserEmail: toUser.email,
  startsOn: approvalDelegations.startsOn,
  endsOn: approvalDelegations.endsOn,
  createdAt: approvalDelegations.createdAt,
  revokedAt: approvalDelegations.revokedAt,
  active: ACTIVE_SQL,
}

const selectDelegations = () =>
  db
    .select(DELEGATION_COLUMNS)
    .from(approvalDelegations)
    .innerJoin(fromUser, eq(fromUser.id, approvalDelegations.fromUserId))
    .innerJoin(toUser, eq(toUser.id, approvalDelegations.toUserId))

/**
 * The delegations in force for the caller RIGHT NOW, as authority they hold.
 *
 * This is the one function the approval path calls: it is what turns "B approved
 * order 12" into "B approved order 12 while holding A's authority".
 */
export const activeDelegationsHeldBy = async (userId: number): Promise<DelegationRow[]> => {
  const rows = await selectDelegations()
    .where(and(eq(approvalDelegations.toUserId, userId), ACTIVE_SQL))
    .orderBy(approvalDelegations.id)
  return rows as DelegationRow[]
}

/**
 * Every delegation in force today, both ends named.
 *
 * Used to annotate the approval-request emails, which are sent to all admins at
 * once — so the recipient list is built first and this decides what each
 * recipient's copy says.
 */
export const allActiveDelegations = async (): Promise<DelegationRow[]> => {
  const rows = await selectDelegations().where(ACTIVE_SQL).orderBy(approvalDelegations.id)
  return rows as DelegationRow[]
}

/**
 * Recipient email → names of the admins they are substituting for.
 *
 * Empty for every recipient who holds nothing, which is the common case.
 */
export const substitutionsByEmail = async (): Promise<Map<string, string[]>> => {
  const map = new Map<string, string[]>()
  for (const d of await allActiveDelegations()) {
    map.set(d.toUserEmail, [...(map.get(d.toUserEmail) ?? []), d.fromUserName])
  }
  return map
}

/** The caller's own delegations, the ones granted to them, and who they may nominate. */
export const listDelegations = async (session: SessionUser): Promise<Result<DelegationsView>> => {
  // Root is refused here, not merely excluded from the candidate list. The route
  // gates on requireRole('admin'), which admits root by rank — so without this,
  // the one role that "does not participate" could still enumerate every active
  // admin through this endpoint. Enforced in the service for the same reason
  // createDelegation does it: the route's rank check is not the contract.
  if (session.role === 'root') return err(403, 'Root does not participate in approval delegation')

  const [mine, grantedToMe, candidates] = await Promise.all([
    selectDelegations()
      .where(eq(approvalDelegations.fromUserId, session.id))
      .orderBy(sql`${approvalDelegations.startsOn} DESC`, sql`${approvalDelegations.id} DESC`),
    selectDelegations()
      .where(eq(approvalDelegations.toUserId, session.id))
      .orderBy(sql`${approvalDelegations.startsOn} DESC`, sql`${approvalDelegations.id} DESC`),
    // Root is excluded on purpose — it does not participate in the approval
    // workflow, so nominating it would grant an authority it is not supposed to
    // exercise.
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.active, true), sql`${users.id} <> ${session.id}`))
      .orderBy(users.name, users.id),
  ])

  return ok({
    mine: mine as DelegationRow[],
    grantedToMe: grantedToMe as DelegationRow[],
    candidates,
  })
}

/**
 * Today's date as Postgres sees it.
 *
 * Read from the database rather than from `new Date()` so the "no backdating"
 * check and the `CURRENT_DATE` comparison that decides whether a delegation is
 * active can never disagree about what day it is.
 */
const currentDate = async (): Promise<string> => {
  const rows = (await db.execute(
    sql`SELECT CURRENT_DATE::text AS today`,
  )) as unknown as { today: string }[]
  return rows[0].today
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A calendar date the caller typed, or null if it is not one. */
const parseDate = (raw: string): string | null => {
  if (!DATE_RE.test(raw)) return null
  // `new Date('2026-02-31')` rolls over to 3 March rather than failing, so the
  // round trip is what actually rejects a date that does not exist.
  const parsed = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10) === raw ? raw : null
}

/**
 * Nominate a substitute approver for a period.
 *
 * The checks that matter are the last two, and they run inside the transaction:
 * both users' rows are locked first, so two delegations created at the same
 * moment cannot each read a clean overlap check and then both insert.
 */
export const createDelegation = async (
  session: SessionUser,
  input: CreateDelegationInput,
): Promise<Result<DelegationRow>> => {
  if (session.role !== 'admin') {
    return err(403, 'Root does not participate in the approval workflow')
  }
  if (input.toUserId === session.id) {
    return err(400, 'A delegation needs a different admin as the substitute')
  }

  const startsOn = parseDate(input.startsOn)
  const endsOn = parseDate(input.endsOn)
  if (!startsOn || !endsOn) return err(400, 'Dates must be calendar dates (YYYY-MM-DD)')
  if (endsOn < startsOn) return err(400, 'The end date cannot be before the start date')

  // No backdating. A delegation that began before it was created would claim
  // authority over decisions already taken, which is exactly what the audit
  // trail is supposed to make impossible.
  const today = await currentDate()
  if (startsOn < today) return err(400, 'A delegation cannot start in the past')

  const [substitute] = await db
    .select({ id: users.id, role: users.role, active: users.active })
    .from(users)
    .where(eq(users.id, input.toUserId))
    .limit(1)

  if (!substitute) return err(404, 'Substitute not found')
  if (substitute.role !== 'admin' || !substitute.active) {
    return err(400, 'The substitute must be an active admin')
  }

  return db.transaction(async (tx): Promise<Result<DelegationRow>> => {
    // Ordered by id so two concurrent creates involving the same pair of admins
    // take the locks in the same order and cannot deadlock.
    await tx
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, [session.id, input.toUserId].sort((a, b) => a - b)))
      .for('update')

    // `starts_on <= endsOn AND ends_on >= startsOn` is period overlap; both
    // periods are inclusive at both ends.
    const overlaps = sql`
      ${approvalDelegations.revokedAt} IS NULL
      AND ${approvalDelegations.startsOn} <= ${endsOn}
      AND ${approvalDelegations.endsOn} >= ${startsOn}
    `

    const [mineAlready] = await tx
      .select({ id: approvalDelegations.id })
      .from(approvalDelegations)
      .where(and(eq(approvalDelegations.fromUserId, session.id), overlaps))
      .limit(1)
    if (mineAlready) {
      return err(409, 'You already have a delegation covering part of that period')
    }

    // The two halves of the no-chains rule. Checked against the requested period
    // rather than today, so a chain cannot be assembled out of two delegations
    // that are each still in the future.
    const [heldByMe] = await tx
      .select({ id: approvalDelegations.id })
      .from(approvalDelegations)
      .where(and(eq(approvalDelegations.toUserId, session.id), overlaps))
      .limit(1)
    if (heldByMe) {
      return err(
        409,
        'You are a substitute for another admin over that period, so you cannot delegate as well',
      )
    }

    const [substituteDelegatedAway] = await tx
      .select({ id: approvalDelegations.id })
      .from(approvalDelegations)
      .where(and(eq(approvalDelegations.fromUserId, input.toUserId), overlaps))
      .limit(1)
    if (substituteDelegatedAway) {
      return err(409, 'That admin has delegated their own approvals over that period')
    }

    const [created] = await tx
      .insert(approvalDelegations)
      .values({ fromUserId: session.id, toUserId: input.toUserId, startsOn, endsOn })
      .returning()

    const [names] = await tx
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, input.toUserId))
      .limit(1)

    await logAudit(
      session.id,
      'approval_delegation.created',
      created.id,
      `${session.email} delegated approval authority to ${names.email} from ${startsOn} to ${endsOn} (inclusive)`,
    )

    return ok({
      id: created.id,
      fromUserId: session.id,
      fromUserName: session.name,
      fromUserEmail: session.email,
      toUserId: input.toUserId,
      toUserName: names.name,
      toUserEmail: names.email,
      startsOn,
      endsOn,
      createdAt: created.createdAt,
      revokedAt: null,
      active: startsOn <= today && endsOn >= today,
    })
  })
}

/**
 * Cancel a delegation the caller granted.
 *
 * Delegator only: the substitute declining is a conversation, not a permission —
 * letting them clear it would leave the away admin believing they were covered.
 * The row is kept and stamped rather than deleted, because the audit entries for
 * decisions taken while it was in force refer to it by id.
 */
export const revokeDelegation = async (
  session: SessionUser,
  delegationId: number,
): Promise<Result<void>> => {
  const [existing] = await db
    .select({
      id: approvalDelegations.id,
      fromUserId: approvalDelegations.fromUserId,
      toUserId: approvalDelegations.toUserId,
      revokedAt: approvalDelegations.revokedAt,
    })
    .from(approvalDelegations)
    .where(eq(approvalDelegations.id, delegationId))
    .limit(1)

  if (!existing) return err(404, 'Delegation not found')
  if (existing.fromUserId !== session.id) return err(403, 'Forbidden')
  if (existing.revokedAt) return err(400, 'Delegation is already revoked')

  const revokedAt = new Date()
  // The UPDATE is the claim, and its row count is the answer. Between the SELECT
  // above and this write another request can revoke the same delegation; the
  // isNull guard already stops the second write, but without reading the result
  // the loser still logged an audit entry and returned 200 for a revoke it did
  // not perform. Same shape as spending a recovery code: claim and check.
  const [revoked] = await db
    .update(approvalDelegations)
    .set({ revokedAt })
    .where(and(eq(approvalDelegations.id, delegationId), isNull(approvalDelegations.revokedAt)))
    .returning({ id: approvalDelegations.id })

  if (!revoked) return err(400, 'Delegation is already revoked')

  await logAudit(
    session.id,
    'approval_delegation.revoked',
    delegationId,
    `${session.email} revoked delegation #${delegationId}`,
  )

  return ok(undefined)
}
