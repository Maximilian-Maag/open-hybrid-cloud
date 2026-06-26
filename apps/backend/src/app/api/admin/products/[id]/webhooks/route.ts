import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { productWebhooks } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

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
  const productId = parseInt(id, 10)

  const rows = await db
    .select()
    .from(productWebhooks)
    .where(eq(productWebhooks.productId, productId))
    .orderBy(productWebhooks.execOrder)

  return NextResponse.json(rows)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const productId = parseInt(id, 10)

  const body = await req.json().catch(() => null)
  const parsed = CreateWebhookSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [webhook] = await db
    .insert(productWebhooks)
    .values({ productId, ...parsed.data })
    .returning()

  return NextResponse.json(webhook, { status: 201 })
}
