import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkLoginPassword, loginWithCredentials } from '@/lib/services/auth'
import { clientIp, clientUserAgent } from '@/lib/auth/requestMeta'
import { MFA_CHALLENGE_TTL_SECONDS } from '@/lib/auth/mfaChallenge'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // Opt-in longer session (issue #37). Absent means the 8 h default; nothing here
  // decides the actual length, only which of the two lifetimes applies. On a
  // two-step sign-in it is sealed into the MFA challenge, so it is answered once,
  // here, and not again at the second step.
  rememberMe: z.boolean().optional(),
  // Check the password and report whether a second factor is needed, minting
  // nothing (#36). See the branch below for why this exists.
  challengeOnly: z.boolean().optional(),
})

const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
// Hard cap on tracked keys so a flood of distinct clients can't grow the map
// without bound (memory-DoS). Once exceeded we evict the oldest entries.
const RATE_LIMIT_MAX_KEYS = 10_000

/**
 * Client address component of the rate-limit key.
 *
 * `X-Forwarded-For` is attacker-controlled unless a trusted reverse proxy sets
 * it, so we only trust it when the operator opts in via `TRUST_PROXY`. Without a
 * trusted proxy there is no reliable per-client address, so this contributes a
 * constant — the account component below still keeps buckets per-account.
 *
 * The trust decision itself lives in `lib/auth/requestMeta.ts`, because a session
 * row records the same address and the two must not be able to disagree about
 * what counts as knowing where a request came from.
 */
function clientAddr(req: NextRequest): string {
  return clientIp(req) ?? '-'
}

/**
 * Per-account rate-limit key: keyed ONLY by the normalized account identifier.
 * A burst of failed guesses against one account can never lock out logins for
 * other accounts, and — because the client IP is deliberately excluded — an
 * attacker cannot get a fresh attempt budget for the same account just by
 * rotating source IPs. Password-spraying across many accounts is capped by the
 * separate per-IP bucket below.
 */
function accountRateLimitKey(email: string): string {
  return `account|${email.trim().toLowerCase()}`
}

/**
 * Per-IP rate-limit key. Caps password spraying — one IP getting a fresh
 * 10-attempt budget for every distinct account it targets. Only meaningful
 * when a trusted proxy provides a reliable source IP (TRUST_PROXY); without it
 * there is no trustworthy address, so returns null and no IP bucket applies.
 */
function ipRateLimitKey(req: NextRequest): string | null {
  const addr = clientAddr(req)
  if (addr === '-') return null
  return `ip|${addr}`
}

/**
 * Drop expired buckets, then—if still over the cap—evict oldest entries by
 * insertion order (Map preserves it) until back under the limit.
 */
function pruneAttempts(now: number): void {
  for (const [key, entry] of loginAttempts) {
    if (entry.resetAt < now) loginAttempts.delete(key)
  }
  if (loginAttempts.size > RATE_LIMIT_MAX_KEYS) {
    const overflow = loginAttempts.size - RATE_LIMIT_MAX_KEYS
    let removed = 0
    for (const key of loginAttempts.keys()) {
      loginAttempts.delete(key)
      if (++removed >= overflow) break
    }
  }
}

function isRateLimited(key: string): boolean {
  const now = Date.now()
  pruneAttempts(now)
  const entry = loginAttempts.get(key)
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  if (entry.count >= RATE_LIMIT_MAX) return true
  entry.count++
  return false
}

function resetRateLimit(key: string): void {
  loginAttempts.delete(key)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = LoginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { email, password, rememberMe, challengeOnly } = parsed.data

  // Two independent buckets protect different attacks:
  //   - per-account (accountRateLimitKey): a burst against one account never
  //     blocks logins for others, and rotating IPs can't refresh its budget.
  //   - per-IP (ipRateLimitKey, TRUST_PROXY only): caps password spraying,
  //     where one IP would otherwise get a fresh budget per targeted account.
  // A request is limited if EITHER bucket is exceeded; count the attempt
  // against every applicable bucket.
  const accountKey = accountRateLimitKey(email)
  const ipKey = ipRateLimitKey(req)
  const rlKeys = [accountKey, ipKey].filter((k): k is string => k !== null)
  let limited = false
  for (const key of rlKeys) {
    // Call isRateLimited for every key so the attempt is counted against all
    // buckets, not just the first that trips.
    if (isRateLimited(key)) limited = true
  }
  if (limited) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again in 15 minutes.' },
      { status: 429 },
    )
  }

  // `challengeOnly` answers one question — is a second factor in the way? — and
  // opens nothing: no `sessions` row, no token, on either branch. It is what the
  // sign-in form's first hop asks, because NextAuth's `authorize` can only say
  // yes or no and the form has to know whether to show a code field. Doing it
  // with an ordinary login instead would open a session for every account
  // WITHOUT a second factor that the browser then discards, leaving a phantom
  // row in that user's own session list (#37).
  if (challengeOnly) {
    const check = await checkLoginPassword(email, password, rememberMe)
    if (!check.ok) {
      return NextResponse.json({ error: check.message }, { status: check.status })
    }
    resetRateLimit(accountKey)
    return NextResponse.json(
      check.data.mfaRequired
        ? { mfaRequired: true, mfaToken: check.data.mfaToken, expiresIn: MFA_CHALLENGE_TTL_SECONDS }
        : { mfaRequired: false },
    )
  }

  const result = await loginWithCredentials(email, password, {
    ip: clientIp(req),
    userAgent: clientUserAgent(req),
    rememberMe,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status })
  }

  // Reset ONLY the authenticated account's bucket. The per-IP bucket keeps its
  // accumulated failures so an attacker can't wipe spraying counters by logging
  // into an account they control.
  resetRateLimit(accountKey)

  // The password was right but the account has a second factor, so this response
  // carries NO session token — and no session row was written either. Only a
  // challenge, which POST /api/auth/login/mfa will trade for a real session once
  // a code proves the second factor. The `token` field is absent rather than
  // null: a client that ignores `mfaRequired` finds nothing to use (#36).
  if (result.data.mfaRequired) {
    return NextResponse.json({
      mfaRequired: true,
      mfaToken: result.data.mfaToken,
      expiresIn: MFA_CHALLENGE_TTL_SECONDS,
    })
  }

  // `mustEnrollSecondFactor` rides along only when it is true (issue #197). The
  // session is real; what it may reach is not, until an authenticator is
  // confirmed. See `requireAuth` — this flag tells the client where to go, it
  // does not decide anything.
  return NextResponse.json({
    token: result.data.token,
    user: result.data.user,
    ...(result.data.mustEnrollSecondFactor ? { mustEnrollSecondFactor: true } : {}),
  })
}
