import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { listProductWebhooks, createProductWebhook } from '@/lib/services/admin/products'

const CreateWebhookSchema = z.object({
  environmentId: z.number().int().positive(),
  name: z.string().min(1),
  webhookUrl: z.string().url(),
  webhookToken: z.string().min(1),
  execOrder: z.number().int().default(0),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseRouteId(id)
  if (productId === null) return invalidId('product id')
  return toResponse(await listProductWebhooks(productId))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseRouteId(id)
  if (productId === null) return invalidId('product id')
  const body = await req.json().catch(() => null)
  const parsed = CreateWebhookSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await createProductWebhook(productId, parsed.data, session.id), 201)
}
