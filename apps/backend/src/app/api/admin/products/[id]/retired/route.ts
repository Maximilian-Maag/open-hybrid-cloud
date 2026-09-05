import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { setProductRetired } from '@/lib/services/admin/products'

const RetiredSchema = z.object({ retired: z.boolean() })

/**
 * Take a product out of the catalogue, or put it back (#251).
 *
 * PUT and not DELETE: this is a state, and it goes both ways. `DELETE
 * /products/:id` already exists and means something else — it destroys the
 * product outright when nothing has ever been ordered from it.
 *
 * `requireRole('root')`, like every other product mutation. The page redirects
 * a non-root admin to /admin, and a route is one fetch away from being called
 * without the page.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseRouteId(id)
  if (productId === null) return invalidId('product id')

  const parsed = RetiredSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await setProductRetired(productId, parsed.data.retired, session.id))
}
