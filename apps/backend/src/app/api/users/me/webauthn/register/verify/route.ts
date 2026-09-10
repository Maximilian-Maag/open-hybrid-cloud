import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuthPendingSecondFactor, isAuth } from '@/lib/auth/middleware'
import { finishRegistration, CREDENTIAL_LABEL_MAX, type RegistrationResponseJSON } from '@/lib/services/webauthn'
import { getBranding } from '@/lib/services/admin/branding'
import { totpIssuer } from '@/lib/services/twoFactor'
import { toResponse } from '@/lib/http'

/**
 * Finish registering a security key (issue #197, part 2).
 *
 * The attestation response is passed through as-is: its shape is the WebAuthn
 * spec's, the library validates it properly, and a Zod schema mirroring it here
 * would be a second, worse copy that drifts. What IS validated here is the label,
 * which is ours.
 *
 * If this is the account's first factor of any kind, the response carries the
 * recovery codes — the only time they are ever shown.
 */
const VerifySchema = z.object({
  label: z.string().min(1).max(CREDENTIAL_LABEL_MAX),
  response: z.object({ id: z.string().min(1) }).passthrough(),
})

export async function POST(req: NextRequest) {
  const session = await requireAuthPendingSecondFactor(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = VerifySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const branding = await getBranding()
  const shopName = totpIssuer(branding.ok ? branding.data.shopName : null)
  const result = await finishRegistration(
    session.id,
    {
      label: parsed.data.label,
      response: parsed.data.response as unknown as RegistrationResponseJSON,
    },
    shopName,
  )

  // Recovery codes must not be cached anywhere: this response is the only copy
  // that will ever exist, and a stale one in a proxy is a set of live credentials.
  const res = toResponse(result)
  if (result.ok && result.data.recoveryCodes) res.headers.set('Cache-Control', 'no-store')
  return res
}
