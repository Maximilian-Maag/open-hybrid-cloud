import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { listComments, createComment, MAX_COMMENT_LENGTH } from '@/lib/services/comments'

const CreateCommentSchema = z.object({
  body: z.string().min(1).max(MAX_COMMENT_LENGTH),
  // Admin/root only — enforced by the service, not by this schema.
  internal: z.boolean().optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const orderId = parseRouteId((await params).id)
  if (orderId === null) return invalidId('order id')

  return toResponse(await listComments(session, orderId))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const orderId = parseRouteId((await params).id)
  if (orderId === null) return invalidId('order id')

  const parsed = CreateCommentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await createComment(session, orderId, parsed.data), 201)
}
