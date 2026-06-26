import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { projects, users, costCenters } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

const CreateProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  costCenterId: z.number().int().positive().optional(),
})

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const isAdmin = session.role === 'admin' || session.role === 'root'

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
    .where(isAdmin ? undefined : eq(projects.ownerId, session.id))
    .orderBy(sql`${projects.createdAt} DESC`)

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = CreateProjectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [project] = await db
    .insert(projects)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? '',
      ownerId: session.id,
      costCenterId: parsed.data.costCenterId ?? null,
    })
    .returning()

  return NextResponse.json(project, { status: 201 })
}
