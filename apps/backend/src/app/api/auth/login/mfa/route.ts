import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { completeMfaLogin } from '@/lib/services/auth'
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
const MfaSchema = z.object({
  mfaToken: z.string().min(1),
  // Loose on shape so the service can tell a mistyped TOTP code apart from a
  // recovery code and count the failure either way. A 400 from Zod would look
  // like a client bug and, more importantly, would not be counted at all.
  code: z.string().min(1).max(64),
})

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
  const result = await completeMfaLogin(parsed.data.mfaToken, parsed.data.code, {
    ip: clientIp(req),
    userAgent: clientUserAgent(req),
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status })
  }

  return NextResponse.json({ token: result.data.token, user: result.data.user })
}
