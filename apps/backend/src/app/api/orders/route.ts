import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listOrders, createOrder } from '@/lib/services/orders'

const CreateOrderSchema = z.object({
  projectId: z.number().int().positive(),
  productId: z.number().int().positive(),
  environmentId: z.number().int().positive(),
  costCenterId: z.number().int().positive().optional(),
  parameters: z.record(z.string()),
})

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  return toResponse(await listOrders(session))
}

export async function POST(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = CreateOrderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await createOrder(session, parsed.data), 201)
}
