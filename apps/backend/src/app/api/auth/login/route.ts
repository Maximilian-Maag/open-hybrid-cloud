import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { loginWithCredentials } from '@/lib/services/auth'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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
 */
function clientAddr(req: NextRequest): string {
  const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true'
  if (trustProxy) {
    const xff = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    if (xff) return xff
  }
  return '-'
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

  const { email, password } = parsed.data

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

  const result = await loginWithCredentials(email, password)

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status })
  }

  // Reset ONLY the authenticated account's bucket. The per-IP bucket keeps its
  // accumulated failures so an attacker can't wipe spraying counters by logging
  // into an account they control.
  resetRateLimit(accountKey)

  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  const sessionUser = rows[0]

  return NextResponse.json({ token: result.data, user: sessionUser })
}
