import { type NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { getInfrastructureElement } from '@/lib/services/infrastructure'

/**
 * One infrastructure element (issue #96).
 *
 * Scoped exactly as the list is: a project manager sees the projects they own, an
 * admin and root see everything. An element outside that scope answers 404 rather
 * than 403, because "this id exists" is itself information about another project.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { id } = await params
  // Digits only: parseInt would read '1abc' and '1.5' as 1 and quietly serve a
  // different element than the one that was asked for.
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid infrastructure id' }, { status: 400 })
  }
  const elementId = Number(id)
  if (!Number.isSafeInteger(elementId) || elementId <= 0) {
    return NextResponse.json({ error: 'Invalid infrastructure id' }, { status: 400 })
  }

  return toResponse(await getInfrastructureElement(session, elementId))
}
