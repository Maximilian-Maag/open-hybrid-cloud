import { type NextRequest } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listFavorites } from '@/lib/services/favorites'

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const lang = new URL(req.url).searchParams.get('lang') ?? 'en'
  return toResponse(await listFavorites(session, lang))
}
