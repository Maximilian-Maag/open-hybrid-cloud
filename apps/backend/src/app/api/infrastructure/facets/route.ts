import { type NextRequest } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listInfrastructureFacets } from '@/lib/services/infrastructure'

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  return toResponse(await listInfrastructureFacets(session))
}
