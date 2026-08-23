import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { getCostCenterById, updateCostCenter, deleteCostCenter } from '@/lib/services/admin/costCenters'

const UpdateCostCenterSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const costCenterId = parseRouteId(id)
  if (costCenterId === null) return invalidId('cost center id')
  return toResponse(await getCostCenterById(costCenterId))
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const costCenterId = parseRouteId(id)
  if (costCenterId === null) return invalidId('cost center id')
  const body = await req.json().catch(() => null)
  const parsed = UpdateCostCenterSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await updateCostCenter(costCenterId, parsed.data, session.id))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const costCenterId = parseRouteId(id)
  if (costCenterId === null) return invalidId('cost center id')
  return toResponse(await deleteCostCenter(costCenterId, session.id))
}
