import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listCart, addToCart, clearCart, pruneOrphanedCartItems } from '@/lib/services/cart'

const AddToCartSchema = z.object({
  productId: z.number().int().positive(),
  environmentId: z.number().int().positive(),
  // Prefill only — validated at checkout, not here. See the service for why.
  parameters: z.record(z.string()).optional(),
})

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  // Drop items whose product has been deleted before listing, so the overview
  // never shows a row that checkout could not possibly accept.
  await pruneOrphanedCartItems(session)
  return toResponse(await listCart(session))
}

export async function POST(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const parsed = AddToCartSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await addToCart(session, parsed.data), 201)
}

export async function DELETE(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  return toResponse(await clearCart(session))
}
