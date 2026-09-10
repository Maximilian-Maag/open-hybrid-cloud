import { type NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listCatalog } from '@/lib/services/catalog'
import { parseCatalogFilters } from '@/lib/services/catalogFilters'

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { searchParams } = new URL(req.url)
  const lang = searchParams.get('lang') ?? 'en'

  const filters = parseCatalogFilters(searchParams)
  if (!filters.ok) {
    return NextResponse.json({ error: filters.message }, { status: filters.status })
  }

  return toResponse(await listCatalog(lang, filters.data))
}
