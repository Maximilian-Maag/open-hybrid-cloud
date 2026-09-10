import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { getCategoryById, updateCategory, deleteCategory } from '@/lib/services/admin/categories'

const UpdateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  displayOrder: z.number().int().optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const categoryId = parseRouteId(id)
  if (categoryId === null) return invalidId('category id')
  return toResponse(await getCategoryById(categoryId))
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const categoryId = parseRouteId(id)
  if (categoryId === null) return invalidId('category id')
  const body = await req.json().catch(() => null)
  const parsed = UpdateCategorySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await updateCategory(categoryId, parsed.data, session.id))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const categoryId = parseRouteId(id)
  if (categoryId === null) return invalidId('category id')
  return toResponse(await deleteCategory(categoryId, session.id))
}
