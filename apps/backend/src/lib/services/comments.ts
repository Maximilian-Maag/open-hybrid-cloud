import type { SessionUser } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import { orderComments, orders, users } from '@/lib/db/schema'
import { and, eq, sql, inArray } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import { sendOrderComment } from '@/lib/notification'
import { findProductName, findAdminEmails } from '@/lib/db/queries'
import { ok, err, type Result } from '@/lib/services/result'

export interface CommentRow {
  id: number
  orderId: number
  userId: number
  body: string
  internal: boolean
  createdAt: Date
  updatedAt: Date
  userName: string | null
  /** True when this comment was edited after posting. */
  edited: boolean
}

export const MAX_COMMENT_LENGTH = 4000

const isAdmin = (session: SessionUser) => session.role === 'admin' || session.role === 'root'

/**
 * Confirm the caller may see the order at all, mirroring getOrderById: an admin
 * sees every order, a project manager only their own.
 */
const assertMaySeeOrder = async (
  session: SessionUser,
  orderId: number,
): Promise<Result<{ userId: number; productId: number }>> => {
  const [order] = await db
    .select({ userId: orders.userId, productId: orders.productId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)

  if (!order) return err(404, 'Order not found')
  if (!isAdmin(session) && order.userId !== session.id) return err(403, 'Forbidden')
  return ok(order)
}

/**
 * The comment thread on an order, oldest first.
 *
 * Internal comments are filtered out in SQL for non-admins rather than hidden in
 * the UI. That is the whole security boundary of the feature: an internal note is
 * written on the assumption the orderer will never read it, so it must not travel
 * to their browser at all.
 */
export const listComments = async (
  session: SessionUser,
  orderId: number,
): Promise<Result<CommentRow[]>> => {
  const allowed = await assertMaySeeOrder(session, orderId)
  if (!allowed.ok) return allowed

  const where = isAdmin(session)
    ? eq(orderComments.orderId, orderId)
    : and(eq(orderComments.orderId, orderId), eq(orderComments.internal, false))

  const rows = await db
    .select({
      id: orderComments.id,
      orderId: orderComments.orderId,
      userId: orderComments.userId,
      body: orderComments.body,
      internal: orderComments.internal,
      createdAt: orderComments.createdAt,
      updatedAt: orderComments.updatedAt,
      userName: users.name,
    })
    .from(orderComments)
    .leftJoin(users, eq(orderComments.userId, users.id))
    .where(where)
    .orderBy(orderComments.createdAt, orderComments.id)

  return ok(
    rows.map((row) => ({
      ...row,
      // Compared here rather than in the browser so every client agrees on what
      // counts as edited.
      edited: row.updatedAt.getTime() !== row.createdAt.getTime(),
    })),
  )
}

const validateBody = (body: string): Result<string> => {
  const trimmed = body.trim()
  if (trimmed === '') return err(400, 'A comment cannot be empty')
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return err(400, `A comment cannot be longer than ${MAX_COMMENT_LENGTH} characters`)
  }
  return ok(trimmed)
}

/**
 * Post a comment on an order.
 *
 * A public comment emails the other participants — the orderer and the admins,
 * never the author, who does not need telling what they just wrote. An internal
 * note deliberately sends nothing to the orderer: notifying them that a note they
 * cannot read exists would leak the very thing the flag is for.
 */
export const createComment = async (
  session: SessionUser,
  orderId: number,
  input: { body: string; internal?: boolean },
): Promise<Result<CommentRow>> => {
  const allowed = await assertMaySeeOrder(session, orderId)
  if (!allowed.ok) return allowed

  const validated = validateBody(input.body)
  if (!validated.ok) return validated

  const internal = input.internal === true
  if (internal && !isAdmin(session)) {
    return err(403, 'Only an admin can add an internal note')
  }

  const [comment] = await db
    .insert(orderComments)
    .values({ orderId, userId: session.id, body: validated.data, internal })
    .returning()

  await logAudit(
    session.id,
    internal ? 'order.comment_internal_added' : 'order.comment_added',
    orderId,
    // The body goes into the immutable log so the thread survives a later delete.
    // Internal bodies land there too, but the audit log is admin-gated to read and
    // export — the same bar as reading the note itself.
    `Comment #${comment.id}: ${validated.data}`,
  )

  if (!internal) {
    await notifyParticipants(session, orderId, allowed.data, validated.data)
  }

  return ok({
    ...comment,
    userName: session.name,
    edited: false,
  })
}

const notifyParticipants = async (
  session: SessionUser,
  orderId: number,
  order: { userId: number; productId: number },
  body: string,
): Promise<void> => {
  const productName = await findProductName(order.productId)

  const [orderer] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, order.userId))
    .limit(1)

  const recipients = new Set<string>()
  if (orderer?.email) recipients.add(orderer.email)
  for (const email of await findAdminEmails()) recipients.add(email)
  // The author already knows.
  recipients.delete(session.email)

  for (const to of recipients) {
    await sendOrderComment(to, productName, orderId, session.name, body)
  }
}

/**
 * Edit one's own comment.
 *
 * Author-only, including for admins: an admin rewriting somebody else's words
 * under their name is worse than leaving a correction in the thread. The original
 * text stays in the audit log either way.
 */
export const updateComment = async (
  session: SessionUser,
  orderId: number,
  commentId: number,
  body: string,
): Promise<Result<CommentRow>> => {
  const existing = await loadOwnComment(session, orderId, commentId)
  if (!existing.ok) return existing

  const validated = validateBody(body)
  if (!validated.ok) return validated

  const [updated] = await db
    .update(orderComments)
    .set({ body: validated.data, updatedAt: new Date() })
    .where(eq(orderComments.id, commentId))
    .returning()

  await logAudit(
    session.id,
    'order.comment_edited',
    orderId,
    `Comment #${commentId} edited. Was: ${existing.data.body} — now: ${validated.data}`,
  )

  return ok({ ...updated, userName: session.name, edited: true })
}

/**
 * Delete one's own comment.
 *
 * A hard delete, not a tombstone: the immutable audit log already holds the body,
 * so the trail survives without leaving a "deleted" placeholder that tells every
 * reader something was said and then withdrawn.
 */
export const deleteComment = async (
  session: SessionUser,
  orderId: number,
  commentId: number,
): Promise<Result<void>> => {
  const existing = await loadOwnComment(session, orderId, commentId)
  if (!existing.ok) return existing

  await db.delete(orderComments).where(eq(orderComments.id, commentId))

  await logAudit(
    session.id,
    'order.comment_deleted',
    orderId,
    `Comment #${commentId} deleted. Was: ${existing.data.body}`,
  )

  return ok(undefined)
}

/**
 * Load a comment the caller is allowed to modify.
 *
 * Scoped by order id as well as comment id, so a comment id from one order cannot
 * be edited through another order's URL — which would otherwise let an admin who
 * can see order B mutate a comment belonging to order A.
 */
const loadOwnComment = async (
  session: SessionUser,
  orderId: number,
  commentId: number,
): Promise<Result<{ body: string }>> => {
  const allowed = await assertMaySeeOrder(session, orderId)
  if (!allowed.ok) return allowed

  const [comment] = await db
    .select({ userId: orderComments.userId, body: orderComments.body, internal: orderComments.internal })
    .from(orderComments)
    .where(and(eq(orderComments.id, commentId), eq(orderComments.orderId, orderId)))
    .limit(1)

  if (!comment) return err(404, 'Comment not found')
  // A non-admin must not learn that an internal note exists, so this is a 404
  // rather than a 403 for them.
  if (comment.internal && !isAdmin(session)) return err(404, 'Comment not found')
  if (comment.userId !== session.id) return err(403, 'Only the author can change a comment')

  return ok({ body: comment.body })
}

/** Comment counts per order, for badging a list without loading every thread. */
export const countCommentsForOrders = async (
  session: SessionUser,
  orderIds: number[],
): Promise<Map<number, number>> => {
  const unique = [...new Set(orderIds)]
  if (unique.length === 0) return new Map()

  // inArray rather than a hand-written `= ANY(...)`: the driver needs the column
  // type to bind the array, and the raw form fails at query time.
  const scope = inArray(orderComments.orderId, unique)
  const rows = await db
    .select({ orderId: orderComments.orderId, count: sql<number>`COUNT(*)::int` })
    .from(orderComments)
    .where(isAdmin(session) ? scope : and(scope, eq(orderComments.internal, false)))
    .groupBy(orderComments.orderId)

  return new Map(rows.map((r) => [r.orderId, r.count]))
}
