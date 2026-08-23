import { type NextRequest } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { listCiBranches } from '@/lib/services/admin/ciSources'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sourceId: string; projectId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { sourceId, projectId } = await params
  const ciSourceId = parseRouteId(sourceId)
  if (ciSourceId === null) return invalidId('CI source id')
  return toResponse(await listCiBranches(ciSourceId, decodeURIComponent(projectId)))
}
