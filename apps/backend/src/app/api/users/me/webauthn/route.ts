import { type NextRequest } from 'next/server'
import { requireAuthPendingSecondFactor, isAuth } from '@/lib/auth/middleware'
import { listCredentials } from '@/lib/services/webauthn'
import { toResponse } from '@/lib/http'
import { ok } from '@/lib/services/result'

/**
 * The security keys on the signed-in account (issue #197, part 2).
 *
 * Nothing secret is returned, and nothing could be: a WebAuthn registration
 * leaves the private key on the authenticator and this table holds only the
 * public half. The labels and dates are what the settings list renders.
 *
 * Reachable while an enrolment is outstanding, like the rest of the enrolment
 * surface — an administrator who owes a factor has to be able to see they have
 * none.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuthPendingSecondFactor(req)
  if (!isAuth(session)) return session
  return toResponse(ok({ credentials: await listCredentials(session.id) }))
}
