import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { checkoutCart, MAX_CART_ITEMS } from '@/lib/services/cart'

const CheckoutSchema = z.object({
  projectId: z.number().int().positive(),
  items: z
    .array(
      z.object({
        cartItemId: z.number().int().positive(),
        parameters: z.record(z.string()),
        costCenterId: z.number().int().positive().optional(),
        trial: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(MAX_CART_ITEMS),
})

/**
 * Order every item in the cart against one project (issue #28).
 *
 * Validates all items before creating any, so a cart with one bad item creates
 * nothing. See the service for why full transactional atomicity is not available.
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const parsed = CheckoutSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await checkoutCart(session, parsed.data), 201)
}
