import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { updateProductEnvironment, deleteProductEnvironment } from '@/lib/services/admin/products'

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
  const body = await req.json().catch(() => null)
  const parsed = UpdateProductEnvironmentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await updateProductEnvironment(parseInt(id, 10), parseInt(envId, 10), parsed.data))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; envId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id, envId } = await params
  return toResponse(await deleteProductEnvironment(parseInt(id, 10), parseInt(envId, 10)))
}
