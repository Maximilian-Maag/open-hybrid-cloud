import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { getEnvironmentById, updateEnvironment, deleteEnvironment } from '@/lib/services/admin/environments'

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
  return toResponse(await getEnvironmentById(parseInt(id, 10)))
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

  return toResponse(await updateEnvironment(parseInt(id, 10), parsed.data))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  return toResponse(await deleteEnvironment(parseInt(id, 10)))
}
