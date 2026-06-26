import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { deploymentEnvironments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const UpdateEnvironmentSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  ciSourceId: z.number().int().positive().optional(),
  webhookUrl: z.string().url().optional(),
  webhookToken: z.string().min(1).optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const rows = await db
    .select()
    .from(deploymentEnvironments)
    .where(eq(deploymentEnvironments.id, parseInt(id, 10)))
    .limit(1)

  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = UpdateEnvironmentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [updated] = await db
    .update(deploymentEnvironments)
    .set(parsed.data)
    .where(eq(deploymentEnvironments.id, parseInt(id, 10)))
    .returning()

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(updated)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const deleted = await db
    .delete(deploymentEnvironments)
    .where(eq(deploymentEnvironments.id, parseInt(id, 10)))
    .returning({ id: deploymentEnvironments.id })

  if (!deleted.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
