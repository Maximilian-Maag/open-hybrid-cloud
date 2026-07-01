import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { getMe, updateMe } from '@/lib/services/auth'

const UpdateProfileSchema = z.object({
  name: z.string().min(1),
})

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  return toResponse(await getMe(session.id))
}

export async function PUT(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = UpdateProfileSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await updateMe(session.id, parsed.data))
}
