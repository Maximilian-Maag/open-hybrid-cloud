import type { SessionUser } from '@open-hybrid-cloud/types'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db/client'
import { countWhere } from '@/lib/db/queries'
import {
  users,
  auditLog,
  orders,
  projects,
  orderComments,
  productVersions,
} from '@/lib/db/schema'
import { count, eq, sql } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'
import { logAudit, logAuditWith, changedFields } from '@/lib/audit'
import { isEmptyUpdate, EMPTY_UPDATE_MESSAGE } from '@/lib/services/updates'
import { revokeAllSessionsOf } from '@/lib/services/sessions'

export interface SafeUser {
  id: number
  email: string
  name: string
  role: string
  active: boolean
  ssoSub: string | null
  createdAt: Date
}

const safeUserColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  active: users.active,
  ssoSub: users.ssoSub,
  createdAt: users.createdAt,
}

export interface CreateUserInput {
  email: string
  name: string
  role: 'admin' | 'project_manager' | 'root'
  password: string
  active: boolean
}

export interface UpdateUserInput {
  name?: string
  role?: 'admin' | 'project_manager' | 'root'
  active?: boolean
  password?: string
}

export const listUsers = async (): Promise<Result<SafeUser[]>> => {
  const rows = await db
    .select(safeUserColumns)
    .from(users)
    .orderBy(sql`${users.createdAt} DESC`)

  return ok(rows as SafeUser[])
}

export const createUser = async (
  input: CreateUserInput,
  actorId?: number,
): Promise<Result<SafeUser>> => {
  const { email, name, role, password, active } = input
  const passwordHash = await bcrypt.hash(password, 12)

  try {
    const [user] = await db
      .insert(users)
      .values({ email, name, role, passwordHash, active })
      .returning(safeUserColumns)

    // The role IS the auditable fact for an account — a new root is the single
    // most consequential admin action there is — and it is not a secret, unlike
    // the password in the same request.
    await logAudit(actorId ?? null, 'user.created', user.id, `Created ${email} with role ${role}`)

    return ok(user as SafeUser)
  } catch (e) {
    const msgs: string[] = []
    if (e instanceof Error) {
      msgs.push(e.message)
      const cause = (e as { cause?: unknown }).cause
      if (cause instanceof Error) msgs.push(cause.message)
      else if (typeof cause === 'object' && cause !== null && 'message' in cause) {
        msgs.push(String((cause as { message: unknown }).message))
      }
    }
    if (msgs.some((m) => m.includes('unique') || m.includes('duplicate'))) {
      return err(409, 'Email already in use')
    }
    throw e
  }
}

export const getUserById = async (id: number): Promise<Result<SafeUser>> => {
  const rows = await db
    .select(safeUserColumns)
    .from(users)
    .where(eq(users.id, id))
    .limit(1)

  if (!rows.length) return err(404, 'Not found')
  return ok(rows[0] as SafeUser)
}

export const updateUser = async (
  id: number,
  input: UpdateUserInput,
  actorId: number | null = null,
): Promise<Result<SafeUser>> => {
  if (isEmptyUpdate(input)) return err(400, EMPTY_UPDATE_MESSAGE)

  const { password, ...rest } = input
  const update: Record<string, unknown> = { ...rest }

  if (password) {
    update.passwordHash = await bcrypt.hash(password, 12)
  }

  // Read before writing, so "the role actually changed" can be answered without
  // treating a no-op PUT that resends the same role as a change — which would
  // sign the user out and write an audit entry for nothing.
  const [before] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)

  const [updated] = await db
    .update(users)
    .set(update)
    .where(eq(users.id, id))
    .returning(safeUserColumns)

  if (!updated) return err(404, 'Not found')

  // `input`, not `update`: `password` is the field name the caller sent, and
  // naming it says an account's password was reset without recording it. A role
  // change is spelled out because promotion to root is what an auditor looks for.
  const roleNote = input.role !== undefined ? ` (role now ${input.role})` : ''
  await logAudit(actorId ?? null, 'user.updated', id, `${changedFields(input)}${roleNote}`)

  // Deactivating an account has to end its sessions (issue #37). `active` is only
  // read at login, so before there were session rows to revoke a deactivated user
  // simply stayed signed in until their token ran out — up to 8 h, or 30 days with
  // "remember me". Clicking "Deactivate" is not a request to wait that long.
  //
  // A ROLE CHANGE ends them for the same reason, and this branch is why it has to.
  // `role` is read from the token, not from the row (middleware.ts), so a demoted
  // admin keeps admin until their token expires. That was already true with a 24 h
  // ceiling; "remember me" raises it to 30 days, which turns a small window into a
  // month. Revoking makes them sign in again and pick up the role they now have.
  if (input.active === false || (input.role !== undefined && input.role !== before?.role)) {
    const reason = input.active === false ? 'Account deactivated' : 'Role changed'
    await revokeAllSessionsOf(actorId, id, reason)
  }

  return ok(updated as SafeUser)
}

export const deleteUser = async (session: SessionUser, id: number): Promise<Result<void>> => {
  if (id === session.id) return err(400, 'Cannot delete your own account')

  // Serialized the way deleteEnvironment is: the reference checks and the DELETE
  // run in one transaction holding FOR UPDATE on the user row, so a concurrent
  // insert of a referencing row (which takes a KEY-SHARE lock on the same row)
  // cannot slip between the pre-check and the delete.
  return db.transaction(async (tx): Promise<Result<void>> => {
    const existing = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, id))
      .for('update')
      .limit(1)
    if (!existing.length) return err(404, 'Not found')

    // Every FK to users.id that is NOT ON DELETE CASCADE. Without this the DELETE
    // raised 23503 and escaped as an unhandled 500 — the same "delete does
    // nothing" symptom deleteEnvironment was fixed for. cart_items and
    // product_favorites are omitted on purpose: they cascade, and a departing
    // user's cart is not history.
    // Counted by Postgres rather than by selecting the ids and taking `.length`:
    // the message quotes exact figures, but a long-serving account's audit trail
    // is thousands of rows and every one of them was being materialized inside
    // this transaction just to be measured.
    const auditCount = await countWhere(tx.select({ n: count() }).from(auditLog).where(eq(auditLog.userId, id)))
    const orderCount = await countWhere(tx.select({ n: count() }).from(orders).where(eq(orders.userId, id)))
    const projectCount = await countWhere(tx.select({ n: count() }).from(projects).where(eq(projects.ownerId, id)))
    const commentCount = await countWhere(tx.select({ n: count() }).from(orderComments).where(eq(orderComments.userId, id)))
    const versionCount = await countWhere(tx.select({ n: count() }).from(productVersions).where(eq(productVersions.createdBy, id)))

    const blockers: string[] = []
    if (auditCount > 0) blockers.push(`${auditCount} audit log entr${auditCount === 1 ? 'y' : 'ies'}`)
    if (orderCount > 0) blockers.push(`${orderCount} order(s)`)
    if (projectCount > 0) blockers.push(`${projectCount} owned project(s)`)
    if (commentCount > 0) blockers.push(`${commentCount} order comment(s)`)
    if (versionCount > 0) blockers.push(`${versionCount} catalogue version(s)`)

    if (blockers.length > 0) {
      // Deactivating is the intended answer, not a workaround: the audit log is
      // append-only (NFA-04.3), so an account that has ever acted cannot be
      // erased without erasing or orphaning its own history. `active: false`
      // already blocks every login path.
      return err(
        409,
        `Cannot delete this account: ${blockers.join(', ')} still reference it. Deactivate it instead (set active to false) — the audit log must keep its author.`,
      )
    }

    const deleted = await tx
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id })

    if (!deleted.length) return err(404, 'Not found')

    // On the transaction's own connection and AFTER the delete, so it rolls back
    // with it. Safe from the FK above because the actor is never the deleted user.
    await logAuditWith(tx, session.id, 'user.deleted', id, `Deleted account ${existing[0].email}`)

    return ok(undefined)
  })
}
