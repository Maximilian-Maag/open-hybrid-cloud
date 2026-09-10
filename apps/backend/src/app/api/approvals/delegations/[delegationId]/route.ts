import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId } from '@/lib/http'
import { revokeDelegation } from '@/lib/services/delegations'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ delegationId: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { delegationId } = await params
  const id = parseRouteId(delegationId)
  if (id === null) return NextResponse.json({ error: 'Delegation not found' }, { status: 404 })

  return toResponse(await revokeDelegation(session, id))
}
