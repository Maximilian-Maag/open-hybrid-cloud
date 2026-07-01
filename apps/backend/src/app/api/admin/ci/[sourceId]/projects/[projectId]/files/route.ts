import { type NextRequest } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listCiFiles } from '@/lib/services/admin/ciSources'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sourceId: string; projectId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { sourceId, projectId } = await params
  const { searchParams } = new URL(req.url)
  const branch = searchParams.get('branch') ?? 'main'
  const path = searchParams.get('path') ?? ''

  return toResponse(await listCiFiles(parseInt(sourceId, 10), decodeURIComponent(projectId), branch, path))
}
