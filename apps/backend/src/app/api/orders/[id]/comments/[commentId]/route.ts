import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { updateComment, deleteComment, MAX_COMMENT_LENGTH } from '@/lib/services/comments'

const UpdateCommentSchema = z.object({
  body: z.string().min(1).max(MAX_COMMENT_LENGTH),
})

/**
 * Both ids are required in the path. Scoping the comment by its order means a
 * comment id from one order cannot be reached through another order's URL.
 */
const parseIds = (raw: { id: string; commentId: string }): { orderId: number; commentId: number } | null => {
  const orderId = Number(raw.id)
  const commentId = Number(raw.commentId)
  if (!Number.isInteger(orderId) || orderId <= 0) return null
  if (!Number.isInteger(commentId) || commentId <= 0) return null
  return { orderId, commentId }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const ids = parseIds(await params)
  if (!ids) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const parsed = UpdateCommentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await updateComment(session, ids.orderId, ids.commentId, parsed.data.body))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const ids = parseIds(await params)
  if (!ids) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  return toResponse(await deleteComment(session, ids.orderId, ids.commentId))
}
