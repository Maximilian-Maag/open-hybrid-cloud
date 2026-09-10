import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { listProductEnvironments, createProductEnvironment } from '@/lib/services/admin/products'

const UpsertProductEnvironmentSchema = z.object({
  environmentId: z.number().int().positive(),
  price: z.string().default('0'),
  currency: z.string().default('EUR'),
  costCenterMode: z.enum(['project', 'select', 'overhead']).default('project'),
  forcedCostCenter: z.boolean().default(false),
  // Nullable so the admin form can clear the overhead account again; the
  // service rejects an id that is unknown or deactivated.
  overheadCostCenterId: z.number().int().positive().nullable().default(null),
  // Time-boxed trials are opt-in per offering (issue #1): a trial provisions real
  // infrastructure with elevated rights inside it.
  trialEnabled: z.boolean().default(false),
  trialDurationMinutes: z.number().int().positive().default(30),
  changelog: z.string().max(2000).optional(),
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
  return toResponse(await listProductEnvironments(productId))
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
  const parsed = UpsertProductEnvironmentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(
    await createProductEnvironment(productId, { ...parsed.data, userId: session.id }),
    201,
  )
}
