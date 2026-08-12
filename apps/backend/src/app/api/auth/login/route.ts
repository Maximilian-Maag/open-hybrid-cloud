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
 * Resolve the rate-limiting key for a request.
 *
 * `X-Forwarded-For` is attacker-controlled unless a trusted reverse proxy sets
 * it, so rotating it would let a client reset its bucket and bypass the limiter.
 * We therefore only trust XFF when the operator explicitly opts in via
 * `TRUST_PROXY` (i.e. the app really does sit behind a proxy that rewrites the
 * header). Otherwise every request shares a single fixed bucket, which is safe
 * against spoofing.
 */
function getClientKey(req: NextRequest): string {
  const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true'
  if (trustProxy) {
    const xff = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    if (xff) return xff
  }
  return 'global'
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
  const clientKey = getClientKey(req)
  if (isRateLimited(clientKey)) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again in 15 minutes.' },
      { status: 429 },
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = LoginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { email, password } = parsed.data
  const result = await loginWithCredentials(email, password)

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status })
  }

  resetRateLimit(clientKey)

  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  const sessionUser = rows[0]

  return NextResponse.json({ token: result.data, user: sessionUser })
}
