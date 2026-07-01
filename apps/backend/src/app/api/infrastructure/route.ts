import { type NextRequest } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listInfrastructure } from '@/lib/services/infrastructure'

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { searchParams } = new URL(req.url)
  const filterProductId = searchParams.get('productId')
  const filterProjectId = searchParams.get('projectId')

  return toResponse(await listInfrastructure(session, {
    productId: filterProductId ? Number(filterProductId) : undefined,
    projectId: filterProjectId ? Number(filterProjectId) : undefined,
  }))
}
