import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { diffProductVersions } from '@/lib/services/versions'

/**
 * Diff two version entries of one product (issue #38).
 *
 * Both ids are scoped to the product by the service, so a version belonging to a
 * different product cannot be compared through this product's URL.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const productId = Number((await params).id)
  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const from = Number(searchParams.get('from'))
  const to = Number(searchParams.get('to'))
  if (!Number.isInteger(from) || from <= 0 || !Number.isInteger(to) || to <= 0) {
    return NextResponse.json({ error: 'from and to must both be version ids' }, { status: 400 })
  }

  return toResponse(await diffProductVersions(productId, from, to))
}
