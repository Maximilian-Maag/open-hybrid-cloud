import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId } from '@/lib/http'
import { probeIntegrationById } from '@/lib/services/admin/integrations'

/**
 * Contact the integration now and record the outcome.
 *
 * POST rather than GET even though nothing about the integration's configuration
 * changes: it makes an outbound request and writes `last_contacted_at` /
 * `last_error`, so it must not be cacheable or prefetchable.
 *
 * A 200 with `{ ok: false, error }` is the normal answer for an unreachable
 * system — the admin asked whether it works, and "no, because …" is a successful
 * answer to that question. Only a missing (404) or disabled (409) integration is
 * an error at the HTTP layer.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const id = parseRouteId((await params).id)
  if (id === null) {
    return NextResponse.json({ error: 'Invalid integration id' }, { status: 400 })
  }

  return toResponse(await probeIntegrationById(id))
}
