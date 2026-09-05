import { type NextRequest } from 'next/server'
import { requireAuthPendingSecondFactor, isAuth } from '@/lib/auth/middleware'
import { startRegistration } from '@/lib/services/webauthn'
import { getBranding } from '@/lib/services/admin/branding'
import { totpIssuer } from '@/lib/services/twoFactor'
import { toResponse } from '@/lib/http'

/**
 * Begin registering a security key (issue #197, part 2).
 *
 * Returns the creation options the browser needs, and stores the challenge
 * server-side so it can be spent exactly once. The shop name comes from branding
 * for the same reason it does for TOTP: it is what the authenticator shows the
 * user, and "Open Hybrid Cloud" on a portal branded as something else is how
 * people end up with entries they cannot identify.
 *
 * POST rather than GET, because it writes: each call replaces any ceremony
 * already in flight for this account.
 */
export async function POST(req: NextRequest) {
  const session = await requireAuthPendingSecondFactor(req)
  if (!isAuth(session)) return session

  const branding = await getBranding()
  const shopName = totpIssuer(branding.ok ? branding.data.shopName : null)
  return toResponse(await startRegistration(session.id, shopName))
}
