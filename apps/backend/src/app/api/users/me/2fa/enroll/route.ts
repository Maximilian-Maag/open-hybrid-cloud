import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { logAudit } from '@/lib/audit'
import { getBranding } from '@/lib/services/admin/branding'
import {
  loadLocalAccount,
  requiresSecondFactor,
  startEnrollment,
  totpIssuer,
  verifySecondFactor,
} from '@/lib/services/twoFactor'

/**
 * Start an enrollment (issue #36).
 *
 * Two gates, and the second is the interesting one:
 *
 *   * The current password, always. A session cookie is not enough to change how
 *     the account authenticates.
 *   * A CURRENT second factor, whenever one is already confirmed. Password alone
 *     would mean a stolen session plus a phished password could replace the
 *     factor and lock the real owner out — which is precisely the attack the
 *     second factor exists to stop. A user whose authenticator is gone uses a
 *     recovery code here; that is what they are for, and it is the "re-enroll via
 *     recovery code" path the issue asks for.
 *
 * Responses use 400/403, never 401: the browser's API client treats a 401 as an
 * expired session and signs the user out globally, which would turn a mistyped
 * password into a surprise logout.
 */
const EnrollSchema = z.object({
  password: z.string().min(1),
  /** A current TOTP code or recovery code. Required only when re-enrolling. */
  code: z.string().min(1).max(64).optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = EnrollSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const account = await loadLocalAccount(session.id)
  if (!account.ok) {
    return NextResponse.json({ error: account.message }, { status: account.status })
  }

  const passwordOk = await bcrypt.compare(parsed.data.password, account.data.passwordHash)
  if (!passwordOk) {
    await logAudit(
      session.id,
      'auth.2fa.enroll_denied',
      session.id,
      'Enrollment refused: wrong password',
    )
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 })
  }

  if (await requiresSecondFactor(session.id)) {
    if (!parsed.data.code) {
      return NextResponse.json(
        {
          error:
            'Two-factor authentication is already active. Provide a current code or a recovery code to enroll a new authenticator.',
          codeRequired: true,
        },
        { status: 403 },
      )
    }
    const verified = await verifySecondFactor(session.id, parsed.data.code, { stage: 'reenroll' })
    if (!verified.ok) {
      return NextResponse.json({ error: verified.message }, { status: verified.status })
    }
  }

  const branding = await getBranding()
  const issuer = totpIssuer(branding.ok ? branding.data.shopName : null)

  const offer = await startEnrollment(session.id, account.data.email, issuer)
  if (!offer.ok) {
    return NextResponse.json({ error: offer.message }, { status: offer.status })
  }

  // Cache-Control on a response that contains a shared secret: an intermediary
  // or a browser back-button replay must not be able to re-serve it.
  return NextResponse.json(offer.data, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
  })
}
