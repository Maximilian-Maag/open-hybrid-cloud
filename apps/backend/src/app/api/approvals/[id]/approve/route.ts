import { type NextRequest } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { approveOrder } from '@/lib/services/approvals'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const orderId = parseRouteId(id)
  if (orderId === null) return invalidId('order id')
  return toResponse(await approveOrder(session, orderId))
}
