import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { updateCartItem, removeFromCart } from '@/lib/services/cart'

const UpdateCartItemSchema = z.object({
  parameters: z.record(z.string()),
})

const parseItemId = (raw: string): number | null => {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** Save the checkout form's progress on one item. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const itemId = parseItemId((await params).itemId)
  if (itemId === null) return NextResponse.json({ error: 'Invalid cart item id' }, { status: 400 })

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

  const itemId = parseItemId((await params).itemId)
  if (itemId === null) return NextResponse.json({ error: 'Invalid cart item id' }, { status: 400 })

  return toResponse(await removeFromCart(session, itemId))
}
