import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { productWebhooks } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

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
  const productId = parseInt(id, 10)
  const webhookId = parseInt(whId, 10)

  const body = await req.json().catch(() => null)
  const parsed = UpdateWebhookSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [updated] = await db
    .update(productWebhooks)
    .set(parsed.data)
    .where(
      and(eq(productWebhooks.id, webhookId), eq(productWebhooks.productId, productId)),
    )
    .returning()

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; whId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, whId } = await params
  const productId = parseInt(id, 10)
  const webhookId = parseInt(whId, 10)

  const deleted = await db
    .delete(productWebhooks)
    .where(
      and(eq(productWebhooks.id, webhookId), eq(productWebhooks.productId, productId)),
    )
    .returning({ id: productWebhooks.id })

  if (!deleted.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
