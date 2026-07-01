import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listProductEnvironments, createProductEnvironment } from '@/lib/services/admin/products'

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
  return toResponse(await listProductEnvironments(parseInt(id, 10)))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = UpsertProductEnvironmentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await createProductEnvironment(parseInt(id, 10), parsed.data), 201)
}
