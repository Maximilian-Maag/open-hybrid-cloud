import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { productEnvironments, deploymentEnvironments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const UpsertProductEnvironmentSchema = z.object({
  environmentId: z.number().int().positive(),
  price: z.string().default('0'),
  currency: z.string().default('EUR'),
  costCenterMode: z.enum(['project', 'select', 'overhead']).default('project'),
  forcedCostCenter: z.boolean().default(false),
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
    .select({
      productId: productEnvironments.productId,
      environmentId: productEnvironments.environmentId,
      price: productEnvironments.price,
      currency: productEnvironments.currency,
      costCenterMode: productEnvironments.costCenterMode,
      forcedCostCenter: productEnvironments.forcedCostCenter,
      environmentName: deploymentEnvironments.name,
    })
    .from(productEnvironments)
    .leftJoin(
      deploymentEnvironments,
      eq(productEnvironments.environmentId, deploymentEnvironments.id),
    )
    .where(eq(productEnvironments.productId, productId))

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
  const parsed = UpsertProductEnvironmentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { environmentId, price, currency, costCenterMode, forcedCostCenter } = parsed.data

  const [row] = await db
    .insert(productEnvironments)
    .values({ productId, environmentId, price, currency, costCenterMode, forcedCostCenter })
    .onConflictDoUpdate({
      target: [productEnvironments.productId, productEnvironments.environmentId],
      set: { price, currency, costCenterMode, forcedCostCenter },
    })
    .returning()

  return NextResponse.json(row, { status: 201 })
}
