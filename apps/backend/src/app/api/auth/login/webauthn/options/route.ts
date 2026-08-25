import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { peekMfaChallengeUserId, verifyMfaChallenge } from '@/lib/auth/mfaChallenge'
import { startAuthentication } from '@/lib/services/webauthn'
import { getBranding } from '@/lib/services/admin/branding'
import { totpIssuer } from '@/lib/services/twoFactor'
import { toResponse } from '@/lib/http'

/**
 * The middle of a two-step sign-in with a security key (issue #197, part 2).
 *
 * `POST /api/auth/login` gives out a challenge when the account has a second
 * factor; this trades that challenge for the WebAuthn request options, and
 * `POST /api/auth/login/mfa` trades the assertion for a session.
 *
 * It authenticates nobody and opens nothing. What it proves is only what the
 * mfaToken already proved — that the password was right — and it is checked the
 * same way `completeMfaLogin` checks it, against the account's CURRENT password
 * hash, so a challenge issued before a password change stops working here too.
 *
 * The options name this account's credentials, which is a small disclosure to
 * someone holding a valid challenge: they already know the password, and the
 * browser needs the list to prompt for the right key.
 */
const OptionsSchema = z.object({ mfaToken: z.string().min(1) })

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = OptionsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const expired = NextResponse.json(
    { error: 'This sign-in attempt has expired. Start again.' },
    { status: 401 },
  )

  // Same two passes as completeMfaLogin: the first only to learn which user to
  // look up, the second to check the signature against that user's credential
  // fingerprint. The first already verifies the signature, so an arbitrary id
  // cannot be smuggled through it.
  const userId = await peekMfaChallengeUserId(parsed.data.mfaToken)
  if (userId === null) return expired

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user || !user.active || !user.passwordHash) return expired

  const challenge = await verifyMfaChallenge(parsed.data.mfaToken, user.passwordHash)
  if (!challenge || challenge.userId !== user.id) return expired

  const branding = await getBranding()
  const shopName = totpIssuer(branding.ok ? branding.data.shopName : null)
  return toResponse(await startAuthentication(user.id, shopName))
}
