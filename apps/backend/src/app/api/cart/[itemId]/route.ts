import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { updateCartItem, removeFromCart } from '@/lib/services/cart'

const UpdateCartItemSchema = z.object({
  parameters: z.record(z.string()),
})

/** Save the checkout form's progress on one item. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const itemId = parseRouteId((await params).itemId)
  if (itemId === null) return invalidId('cart item id')

  const parsed = UpdateCartItemSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await updateCartItem(session, itemId, parsed.data.parameters))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const itemId = parseRouteId((await params).itemId)
  if (itemId === null) return invalidId('cart item id')

  return toResponse(await removeFromCart(session, itemId))
}
