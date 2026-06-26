import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { productEnvironments } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

const UpdateProductEnvironmentSchema = z.object({
  price: z.string().optional(),
  currency: z.string().optional(),
  costCenterMode: z.enum(['project', 'select', 'overhead']).optional(),
  forcedCostCenter: z.boolean().optional(),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; envId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, envId } = await params
  const productId = parseInt(id, 10)
  const environmentId = parseInt(envId, 10)

  const body = await req.json().catch(() => null)
  const parsed = UpdateProductEnvironmentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [updated] = await db
    .update(productEnvironments)
    .set(parsed.data)
    .where(
      and(
        eq(productEnvironments.productId, productId),
        eq(productEnvironments.environmentId, environmentId),
      ),
    )
    .returning()

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; envId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, envId } = await params
  const productId = parseInt(id, 10)
  const environmentId = parseInt(envId, 10)

  const deleted = await db
    .delete(productEnvironments)
    .where(
      and(
        eq(productEnvironments.productId, productId),
        eq(productEnvironments.environmentId, environmentId),
      ),
    )
    .returning({ productId: productEnvironments.productId })

  if (!deleted.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
