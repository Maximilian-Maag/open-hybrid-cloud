import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { getCiSourceById, updateCiSource, deleteCiSource } from '@/lib/services/admin/ciSources'

const UpdateCiSourceSchema = z.object({
  name: z.string().min(1).optional(),
  url: z.string().url().optional(),
  accessToken: z.string().min(1).optional(),
  provider: z.enum(['gitlab', 'github', 'bitbucket']).optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  return toResponse(await getCiSourceById(parseInt(id, 10)))
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = UpdateCiSourceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await updateCiSource(parseInt(id, 10), parsed.data))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  return toResponse(await deleteCiSource(parseInt(id, 10)))
}
