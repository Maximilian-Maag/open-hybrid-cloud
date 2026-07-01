import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { getProjectById, updateProject, deleteProject } from '@/lib/services/projects'

const UpdateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  costCenterId: z.number().int().positive().nullable().optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { id } = await params
  return toResponse(await getProjectById(session, parseInt(id, 10)))
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = UpdateProjectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await updateProject(session, parseInt(id, 10), parsed.data))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  return toResponse(await deleteProject(session, parseInt(id, 10)))
}
