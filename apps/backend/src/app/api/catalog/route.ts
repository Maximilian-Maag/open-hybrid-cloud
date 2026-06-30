import { type NextRequest } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listCatalog } from '@/lib/services/catalog'

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { searchParams } = new URL(req.url)
  const lang = searchParams.get('lang') ?? 'en'
  const search = searchParams.get('search') ?? undefined
  const categoryId = searchParams.get('categoryId')
    ? parseInt(searchParams.get('categoryId') ?? '0', 10)
    : undefined

  return toResponse(await listCatalog(lang, search, categoryId))
}
