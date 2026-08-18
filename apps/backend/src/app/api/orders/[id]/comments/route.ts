import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listComments, createComment, MAX_COMMENT_LENGTH } from '@/lib/services/comments'

const CreateCommentSchema = z.object({
  body: z.string().min(1).max(MAX_COMMENT_LENGTH),
  // Admin/root only — enforced by the service, not by this schema.
  internal: z.boolean().optional(),
})

const parseOrderId = (raw: string): number | null => {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const orderId = parseOrderId((await params).id)
  if (orderId === null) return NextResponse.json({ error: 'Invalid order id' }, { status: 400 })

  return toResponse(await listComments(session, orderId))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const orderId = parseOrderId((await params).id)
  if (orderId === null) return NextResponse.json({ error: 'Invalid order id' }, { status: 400 })

  const parsed = CreateCommentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await createComment(session, orderId, parsed.data), 201)
}
