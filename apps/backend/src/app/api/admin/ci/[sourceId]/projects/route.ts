import { type NextRequest } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listCiProjects } from '@/lib/services/admin/ciSources'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { sourceId } = await params
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? undefined

  return toResponse(await listCiProjects(parseInt(sourceId, 10), search))
}
