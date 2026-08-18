import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { retryProvisioning } from '@/lib/services/infrastructure'

/**
 * Admin and above only. Retrying re-fires CI pipelines against real
 * infrastructure, which is a heavier action than the decommission an orderer may
 * perform on their own elements.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid infrastructure id' }, { status: 400 })
  }

  return toResponse(await retryProvisioning(session, id))
}
