import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { scheduleDecommission } from '@/lib/services/infrastructure'

const ScheduleSchema = z.object({
  // Nullable rather than optional: clearing the schedule has to be expressible,
  // and an omitted field would be indistinguishable from a malformed body.
  scheduledAt: z.string().datetime({ offset: true }).nullable(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid infrastructure id' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const parsed = ScheduleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request — scheduledAt must be an ISO-8601 timestamp with offset, or null', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const scheduledAt = parsed.data.scheduledAt === null ? null : new Date(parsed.data.scheduledAt)
  return toResponse(await scheduleDecommission(session, id, scheduledAt))
}
