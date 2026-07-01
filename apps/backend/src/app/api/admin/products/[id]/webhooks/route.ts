import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
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
  return toResponse(await listProductWebhooks(parseInt(id, 10)))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = CreateWebhookSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await createProductWebhook(parseInt(id, 10), parsed.data), 201)
}
