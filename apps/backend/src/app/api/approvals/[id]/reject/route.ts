import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { rejectOrder } from '@/lib/services/approvals'

const RejectSchema = z.object({
  rejectionNote: z.string().min(1),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = RejectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await rejectOrder(session, parseInt(id, 10), parsed.data.rejectionNote))
}
