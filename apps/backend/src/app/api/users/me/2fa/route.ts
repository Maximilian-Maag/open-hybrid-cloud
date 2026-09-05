import { type NextRequest, NextResponse } from 'next/server'
import { requireAuthPendingSecondFactor, isAuth } from '@/lib/auth/middleware'
import { getTwoFactorStatus } from '@/lib/services/twoFactor'
import { toResponse } from '@/lib/http'

/**
 * The signed-in user's own second-factor status (issue #36).
 *
 * Status only — no secret, no recovery codes, nothing that could be replayed.
 * There is deliberately no DELETE here: a confirmed factor cannot be turned off
 * through the API, only replaced by a new enrollment. The emergency exit is an
 * operator with database access, documented in docs/guides/root.md.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuthPendingSecondFactor(req)
  if (!isAuth(session)) return session
  return toResponse(await getTwoFactorStatus(session.id))
}

/**
 * Spelled out so the absence is a decision rather than an oversight, and so the
 * response says why instead of Next's bare 405.
 */
export async function DELETE() {
  return NextResponse.json(
    {
      error:
        'Two-factor authentication cannot be disabled once it is set up. Enroll a new authenticator instead.',
    },
    { status: 405 },
  )
}
