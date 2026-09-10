import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { updateProductWebhook, deleteProductWebhook } from '@/lib/services/admin/products'

const UpdateWebhookSchema = z.object({
  environmentId: z.number().int().positive().optional(),
  name: z.string().min(1).optional(),
  webhookUrl: z.string().url().optional(),
  webhookToken: z.string().min(1).optional(),
  execOrder: z.number().int().optional(),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; whId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, whId } = await params
  const productId = parseRouteId(id)
  if (productId === null) return invalidId('product id')
  const webhookId = parseRouteId(whId)
  if (webhookId === null) return invalidId('webhook id')
  const body = await req.json().catch(() => null)
  const parsed = UpdateWebhookSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await updateProductWebhook(productId, webhookId, parsed.data, session.id))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; whId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, whId } = await params
  const productId = parseRouteId(id)
  if (productId === null) return invalidId('product id')
  const webhookId = parseRouteId(whId)
  if (webhookId === null) return invalidId('webhook id')
  return toResponse(await deleteProductWebhook(productId, webhookId, session.id))
}
