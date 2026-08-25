import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { completeMfaLogin, type SecondFactorProof } from '@/lib/services/auth'
import type { AuthenticationResponseJSON } from '@/lib/services/webauthn'
import { clientIp, clientUserAgent } from '@/lib/auth/requestMeta'

/**
 * Second half of a two-step login (issue #36).
 *
 * `POST /api/auth/login` returns a challenge instead of a session when the
 * account has a second factor; this endpoint trades that challenge plus a code
 * for the session token. Nothing here re-checks the password: the challenge is
 * the proof, and it is signed with a key derived separately from the session key
 * so it can never be presented as a session token itself.
 *
 * There is no per-IP rate limit on this route. The limit lives on the account, in
 * the database (`user_totp.failed_attempts` / `locked_until`), because a code is
 * a 10^6 space and a process-local counter is defeated by a restart or a second
 * replica — see lib/services/twoFactor.ts.
 */
/**
 * One of the two, never both and never neither (issue #197, part 2).
 *
 * A union rather than two optional fields: a request carrying both is a client
 * that has not decided which factor it is presenting, and silently preferring one
 * would make which of them was actually checked unobservable.
 */
const MfaSchema = z.union([
  z.object({
    mfaToken: z.string().min(1),
    // Loose on shape so the service can tell a mistyped TOTP code apart from a
    // recovery code and count the failure either way. A 400 from Zod would look
    // like a client bug and, more importantly, would not be counted at all.
    code: z.string().min(1).max(64),
    webauthn: z.undefined(),
  }),
  z.object({
    mfaToken: z.string().min(1),
    code: z.undefined(),
    // Passed through as the spec shapes it; the library is what validates it.
    // Mirroring the whole structure in Zod would be a second, worse copy.
    webauthn: z.object({ id: z.string().min(1) }).passthrough(),
  }),
])

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = MfaSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  // The session is opened HERE, once the code has been checked, and through the
  // same `createSession` every other sign-in uses — so it appears in the user's
  // session list and can be revoked like any other (#37). The lifetime comes from
  // the "remember me" claim sealed into the challenge, not from this request.
  const proof: SecondFactorProof =
    parsed.data.webauthn === undefined
      ? { kind: 'code', code: parsed.data.code }
      : { kind: 'webauthn', response: parsed.data.webauthn as unknown as AuthenticationResponseJSON }

  const result = await completeMfaLogin(parsed.data.mfaToken, proof, {
    ip: clientIp(req),
    userAgent: clientUserAgent(req),
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status })
  }

  return NextResponse.json({ token: result.data.token, user: result.data.user })
}
