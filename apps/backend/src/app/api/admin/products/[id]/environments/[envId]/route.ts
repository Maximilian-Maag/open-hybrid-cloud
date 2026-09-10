import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { createProductEnvironment, deleteProductEnvironment } from '@/lib/services/admin/products'

const UpdateProductEnvironmentSchema = z.object({
  price: z.string().optional(),
  currency: z.string().optional(),
  costCenterMode: z.enum(['project', 'select', 'overhead']).optional(),
  forcedCostCenter: z.boolean().optional(),
  // Nullable so the admin form can clear the overhead account again; the
  // service rejects an id that is unknown or deactivated.
  overheadCostCenterId: z.number().int().positive().nullable().optional(),
  trialEnabled: z.boolean().optional(),
  trialDurationMinutes: z.number().int().positive().optional(),
  changelog: z.string().max(2000).optional(),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; envId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, envId } = await params
  const productId = parseRouteId(id)
  if (productId === null) return invalidId('product id')
  const environmentId = parseRouteId(envId)
  if (environmentId === null) return invalidId('environment id')
  const body = await req.json().catch(() => null)
  const parsed = UpdateProductEnvironmentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(
    await createProductEnvironment(productId, {
      environmentId,
      ...parsed.data,
      userId: session.id,
    }),
  )
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; envId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, envId } = await params
  const productId = parseRouteId(id)
  if (productId === null) return invalidId('product id')
  const environmentId = parseRouteId(envId)
  if (environmentId === null) return invalidId('environment id')
  return toResponse(await deleteProductEnvironment(productId, environmentId, session.id))
}
