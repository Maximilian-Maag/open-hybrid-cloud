import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { updateComment, deleteComment, MAX_COMMENT_LENGTH } from '@/lib/services/comments'

const UpdateCommentSchema = z.object({
  body: z.string().min(1).max(MAX_COMMENT_LENGTH),
})

/**
 * Both ids are required in the path. Scoping the comment by its order means a
 * comment id from one order cannot be reached through another order's URL.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { id: rawOrderId, commentId: rawCommentId } = await params
  const orderId = parseRouteId(rawOrderId)
  if (orderId === null) return invalidId('order id')
  const commentId = parseRouteId(rawCommentId)
  if (commentId === null) return invalidId('comment id')

  const parsed = UpdateCommentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await updateComment(session, orderId, commentId, parsed.data.body))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { id: rawOrderId, commentId: rawCommentId } = await params
  const orderId = parseRouteId(rawOrderId)
  if (orderId === null) return invalidId('order id')
  const commentId = parseRouteId(rawCommentId)
  if (commentId === null) return invalidId('comment id')

  return toResponse(await deleteComment(session, orderId, commentId))
}
