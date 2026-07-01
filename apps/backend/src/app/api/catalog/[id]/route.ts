import { type NextRequest } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { getProduct } from '@/lib/services/catalog'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseInt(id, 10)
  const { searchParams } = new URL(req.url)
  const lang = searchParams.get('lang') ?? 'en'
  const environmentIdParam = searchParams.get('environmentId')
  const environmentId = environmentIdParam ? parseInt(environmentIdParam, 10) : undefined

  return toResponse(await getProduct(productId, lang, environmentId))
}
