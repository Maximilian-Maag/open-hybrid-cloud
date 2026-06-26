import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { parameters } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const UpdateParameterSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['string', 'number', 'bool', 'dropdown']).optional(),
  description: z.string().optional(),
  defaultValue: z.string().optional(),
  required: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  environmentId: z.number().int().positive().nullable().optional(),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = UpdateParameterSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [updated] = await db
    .update(parameters)
    .set(parsed.data)
    .where(eq(parameters.id, parseInt(id, 10)))
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
    .delete(parameters)
    .where(eq(parameters.id, parseInt(id, 10)))
    .returning({ id: parameters.id })

  if (!deleted.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
