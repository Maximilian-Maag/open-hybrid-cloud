import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuthPendingSecondFactor, isAuth } from '@/lib/auth/middleware'
import { confirmEnrollment } from '@/lib/services/twoFactor'

/**
 * Finish an enrollment and receive the recovery codes (issue #36).
 *
 * No role check here on purpose: `confirmEnrollment` goes through the same
 * `loadTwoFactorAccount` gate as `enroll` and the status endpoint, so root-only
 * is decided once instead of being restated in three handlers that can drift.
 *
 * A code from the new authenticator is what proves the secret actually reached an
 * app — without it, a user who mis-scanned the QR would be locked out of their
 * own account on the next login with no way back in. Only once that is proven
 * does the pending secret become the live one.
 *
 * The recovery codes come back HERE rather than from `enroll`, and this is the
 * only time they are ever readable: they are stored as hashes, so the response
 * body is the sole copy. Two reasons for issuing them at confirmation rather than
 * at the start: an abandoned enrollment must not invalidate the codes the user is
 * currently relying on, and a set of codes for a secret that never reached a
 * phone is worse than useless — it is standing credentials nobody wrote down.
 */
const ConfirmSchema = z.object({
  code: z.string().min(1).max(64),
})

export async function POST(req: NextRequest) {
  const session = await requireAuthPendingSecondFactor(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = ConfirmSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const result = await confirmEnrollment(session.id, parsed.data.code)
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status })
  }

  return NextResponse.json(result.data, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
  })
}
