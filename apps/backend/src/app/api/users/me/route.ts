import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, requireAuthPendingSecondFactor, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { getMe, updateMe } from '@/lib/services/auth'

const UpdateProfileSchema = z.object({
  name: z.string().min(1),
})

/**
 * Reachable by an administrator who still owes a second factor (issue #197),
 * because the app shell cannot draw the enrolment screen without knowing who is
 * signed in. Read-only, and it returns nothing the caller does not already have.
 * `PUT` below stays gated: editing your own name is not part of enrolling.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuthPendingSecondFactor(req)
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
