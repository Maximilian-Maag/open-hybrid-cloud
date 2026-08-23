import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { changePassword } from '@/lib/services/auth'

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
})

export async function PUT(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = ChangePasswordSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const result = await changePassword(
    session.id,
    parsed.data.currentPassword,
    parsed.data.newPassword,
    // The tab the user is standing in. Every other session of this account is
    // ended by the change; this one just proved it knows the old password.
    session.sessionId,
  )
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })

  return NextResponse.json({ success: true })
}
