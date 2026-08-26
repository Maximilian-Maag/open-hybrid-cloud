import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { markOrderFailed } from '@/lib/services/orders'

const WriteOffSchema = z.object({
  reason: z.string().min(1),
})

/**
 * Write off an order whose pipeline never reported back (#206).
 *
 * `requireRole('root')`, which is stricter than the 'admin' its neighbours take.
 * This writes a status nobody observed — the platform is recording a failure it
 * inferred from silence rather than one CI told it about — and that is a call
 * for the person who owns the installation, not for anyone who can approve an
 * order. The service checks the role a second time: a route is one import away
 * from being reused, and the audit entry this writes has to be true.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const orderId = parseRouteId(id)
  if (orderId === null) return invalidId('order id')

  const body = await req.json().catch(() => null)
  const parsed = WriteOffSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await markOrderFailed(session, orderId, parsed.data.reason))
}
