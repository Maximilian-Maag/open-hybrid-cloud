import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { projects, users, costCenters } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

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
  const projectId = parseInt(id, 10)

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      ownerId: projects.ownerId,
      costCenterId: projects.costCenterId,
      createdAt: projects.createdAt,
      ownerName: users.name,
      costCenterName: costCenters.name,
    })
    .from(projects)
    .leftJoin(users, eq(projects.ownerId, users.id))
    .leftJoin(costCenters, eq(projects.costCenterId, costCenters.id))
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!rows.length) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const project = rows[0]

  if (session.role === 'project_manager' && project.ownerId !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json(project)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const projectId = parseInt(id, 10)

  const existing = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!existing.length) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  if (session.role === 'project_manager' && existing[0].ownerId !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = UpdateProjectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const update: Partial<typeof parsed.data> = {}
  if (parsed.data.name !== undefined) update.name = parsed.data.name
  if (parsed.data.description !== undefined) update.description = parsed.data.description
  if (parsed.data.costCenterId !== undefined) update.costCenterId = parsed.data.costCenterId

  const [updated] = await db
    .update(projects)
    .set(update)
    .where(eq(projects.id, projectId))
    .returning()

  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const projectId = parseInt(id, 10)

  const deleted = await db
    .delete(projects)
    .where(eq(projects.id, projectId))
    .returning({ id: projects.id })

  if (!deleted.length) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
