import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import type * as jwt from '@/lib/auth/jwt'
import { verifyToken, signToken } from '@/lib/auth/jwt'

vi.mock('@/lib/auth/jwt', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof jwt
  return { ...actual, signToken: vi.fn(actual.signToken) }
})
import { createUser } from '@/test/helpers'
import { hashToken } from '@/lib/auth/sessions'
import { db } from '@/lib/db/client'
import { sessions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/auth/login', () => {
  it('returns a JWT token for valid credentials', async () => {
    // A project manager, because since #197 an administrator holds a second
    // factor and signing one in is a two-step flow — covered separately below.
    await createUser({ email: 'login@test.dev', password: 'correct-pass', role: 'project_manager' })

    const res = await POST(makeRequest({ email: 'login@test.dev', password: 'correct-pass' }))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.token).toBeDefined()
    expect(body.user.email).toBe('login@test.dev')
    expect(body.user.role).toBe('project_manager')

    const claims = await verifyToken(body.token)
    expect(claims?.user.email).toBe('login@test.dev')
    // Every token now names the session row it belongs to (#37); without one it
    // would be refused by the very next request.
    expect(claims?.sid).toBeGreaterThan(0)
  })

  it('records the session, with where it came from and a digest of the token', async () => {
    const prev = process.env.TRUST_PROXY
    process.env.TRUST_PROXY = '1'
    try {
      const user = await createUser({ email: 'session-row@test.dev', password: 'correct-pass' })
      const res = await POST(
        new NextRequest('http://localhost/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'session-row@test.dev', password: 'correct-pass' }),
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': '198.51.100.9',
            'user-agent': 'Mozilla/5.0 (Macintosh) TestBrowser/1.0',
          },
        }),
      )
      expect(res.status).toBe(200)
      const token = (await res.json()).token as string

      const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id))
      expect(rows).toHaveLength(1)
      expect(rows[0].ip).toBe('198.51.100.9')
      expect(rows[0].userAgent).toBe('Mozilla/5.0 (Macintosh) TestBrowser/1.0')
      expect(rows[0].revokedAt).toBeNull()
      // The token is never stored, only its SHA-256 — a database dump must not be
      // a bag of working credentials.
      expect(rows[0].tokenHash).toBe(hashToken(token))
      expect(token).not.toContain(rows[0].tokenHash)
      expect(rows[0].tokenHash).not.toContain(token.slice(0, 16))
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY
      else process.env.TRUST_PROXY = prev
    }
  })

  it('leaves ip null when no proxy is trusted, rather than recording a spoofable header', async () => {
    const prev = process.env.TRUST_PROXY
    delete process.env.TRUST_PROXY
    try {
      const user = await createUser({ email: 'untrusted-ip@test.dev', password: 'correct-pass' })
      await POST(
        new NextRequest('http://localhost/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'untrusted-ip@test.dev', password: 'correct-pass' }),
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
        }),
      )
      const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id))
      expect(rows[0].ip).toBeNull()
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY
      else process.env.TRUST_PROXY = prev
    }
  })

  it('honours "remember me" with a 30-day session instead of 8 h', async () => {
    const user = await createUser({ email: 'remember@test.dev', password: 'correct-pass' })

    const before = Date.now()
    await POST(makeRequest({ email: 'remember@test.dev', password: 'correct-pass' }))
    await POST(makeRequest({ email: 'remember@test.dev', password: 'correct-pass', rememberMe: true }))

    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .orderBy(sessions.id)
    expect(rows).toHaveLength(2)

    // Measured against this process's clock, not the database's: expires_at is
    // computed here, and the container's NOW() is a different clock.
    const ttlSeconds = (row: typeof rows[number]) =>
      Math.round((row.expiresAt.getTime() - before) / 1000)
    expect(ttlSeconds(rows[0])).toBeGreaterThan(8 * 60 * 60 - 60)
    expect(ttlSeconds(rows[0])).toBeLessThanOrEqual(8 * 60 * 60)
    expect(ttlSeconds(rows[1])).toBeGreaterThan(30 * 24 * 60 * 60 - 60)
    expect(ttlSeconds(rows[1])).toBeLessThanOrEqual(30 * 24 * 60 * 60)
  })

  it('rejects a rememberMe that is not a boolean rather than coercing it', async () => {
    await createUser({ email: 'coerce@test.dev', password: 'correct-pass' })
    const res = await POST(
      makeRequest({ email: 'coerce@test.dev', password: 'correct-pass', rememberMe: 'yes' }),
    )
    expect(res.status).toBe(400)
  })

  it('reports a misconfigured signing secret as a server error, not as bad credentials', async () => {
    // The credentials are correct here. Before, signToken threw, the route 500'd
    // with no body, and NextAuth surfaced CredentialsSignin — so a deployment
    // whose JWT_SECRET was too short looked exactly like a wrong password, and
    // that is what got debugged.
    //
    // The failure is injected rather than provoked with a short JWT_SECRET,
    // because jwt.ts caches the encoded secret on first use: by the time this
    // test runs, a valid one is already cached and stubbing the env does nothing.
    await createUser({ email: 'misconfig@test.dev', password: 'correct-pass' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(signToken).mockRejectedValueOnce(
      new Error('JWT_SECRET must be set and at least 32 characters long'),
    )

    const res = await POST(makeRequest({ email: 'misconfig@test.dev', password: 'correct-pass' }))

    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/misconfigured/i)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[auth]'), expect.anything())

    // And no half-written session row survives it. The insert and the token-hash
    // update are one transaction (#37), so a token that never came into existence
    // cannot leave behind a row nothing could ever validate against.
    expect(await db.select().from(sessions)).toEqual([])
  })

  it('returns 401 for wrong password', async () => {
    await createUser({ email: 'wrongpw@test.dev', password: 'correct-pass' })

    const res = await POST(makeRequest({ email: 'wrongpw@test.dev', password: 'wrong-pass' }))
    expect(res.status).toBe(401)

    const body = await res.json()
    expect(body.error).toBe('Invalid credentials')
  })

  it('returns 401 for non-existent user', async () => {
    const res = await POST(makeRequest({ email: 'nobody@test.dev', password: 'any-pass' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 for inactive user', async () => {
    await createUser({ email: 'inactive@test.dev', password: 'correct-pass', active: false })

    const res = await POST(makeRequest({ email: 'inactive@test.dev', password: 'correct-pass' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid email format', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email', password: 'pass' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing password', async () => {
    const res = await POST(makeRequest({ email: 'user@test.dev' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for non-JSON body', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: 'not json',
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('does not return the password hash in response', async () => {
    await createUser({ email: 'nohash@test.dev', password: 'secret' })
    const res = await POST(makeRequest({ email: 'nohash@test.dev', password: 'secret' }))
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('$2')
  })

  // NFA-05.1: login rate-limit per IP — only meaningful when the proxy is
  // trusted, so these tests opt into TRUST_PROXY and use unique IPs to get
  // their own buckets (isolated from the module-level shared 'global' bucket).
  it('rate-limits repeated failed logins from the same IP when TRUST_PROXY set (NFA-05.1)', async () => {
    const prev = process.env.TRUST_PROXY
    process.env.TRUST_PROXY = '1'
    try {
      await createUser({ email: 'ratelimit@test.dev', password: 'correct-pass' })
      const ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`

      const makeReq = (email: string, password: string) =>
        new NextRequest('http://localhost/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
          headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        })

      // Fire 10 failed attempts — all should return 401 (bad password), not 429
      for (let i = 0; i < 10; i++) {
        const res = await POST(makeReq('ratelimit@test.dev', 'wrong-pass'))
        expect(res.status).toBe(401)
      }

      // The 11th attempt from the same IP is rate-limited even with valid creds
      const blocked = await POST(makeReq('ratelimit@test.dev', 'correct-pass'))
      expect(blocked.status).toBe(429)
      const body = await blocked.json()
      expect(body.error).toMatch(/too many/i)
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY
      else process.env.TRUST_PROXY = prev
    }
  })

  // NFA-05.1: password-spraying cap — with TRUST_PROXY set, one IP hammering
  // MANY different accounts must eventually trip the per-IP bucket, even though
  // each individual account bucket is nowhere near its limit.
  it('caps password spraying across different accounts from one IP when TRUST_PROXY set (NFA-05.1)', async () => {
    const prev = process.env.TRUST_PROXY
    process.env.TRUST_PROXY = '1'
    try {
      const ip = `10.5.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`
      const attempt = async (email: string, password: string) =>
        POST(
          new NextRequest('http://localhost/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
            headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
          }),
        )

      // 10 failed guesses, each against a DIFFERENT (non-existent) account, so
      // no single account bucket is near its cap — only the shared IP bucket is.
      for (let i = 0; i < 10; i++) {
        const res = await attempt(`spray-${i}@test.dev`, 'wrong-pass')
        expect(res.status).toBe(401)
      }

      // The 11th attempt from this IP — even targeting yet another fresh account
      // with valid-looking creds — is blocked by the per-IP bucket.
      const blocked = await attempt('spray-victim@test.dev', 'whatever')
      expect(blocked.status).toBe(429)
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY
      else process.env.TRUST_PROXY = prev
    }
  })

  it('limits an account regardless of source IP — rotating IPs does not refresh its budget (NFA-05.1)', async () => {
    const prev = process.env.TRUST_PROXY
    process.env.TRUST_PROXY = '1'
    try {
      await createUser({ email: 'per-account@test.dev', password: 'correct-pass' })

      const attempt = async (ip: string, password: string) =>
        POST(
          new NextRequest('http://localhost/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'per-account@test.dev', password }),
            headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
          }),
        )

      // 10 failed guesses against the same account, each from a DIFFERENT IP.
      for (let i = 0; i < 10; i++) {
        const res = await attempt(`10.9.0.${i + 1}`, 'wrong')
        expect(res.status).toBe(401)
      }

      // An 11th attempt from yet another fresh IP is still blocked: the account
      // bucket is IP-independent, so rotating source IPs can't refresh it.
      const blocked = await attempt('10.9.0.250', 'correct-pass')
      expect(blocked.status).toBe(429)
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY
      else process.env.TRUST_PROXY = prev
    }
  })

  it('a successful login does not reset the per-IP spraying bucket (NFA-05.1)', async () => {
    const prev = process.env.TRUST_PROXY
    process.env.TRUST_PROXY = '1'
    try {
      await createUser({ email: 'ipreset@test.dev', password: 'correct-pass' })
      const ip = `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`
      const attempt = async (email: string, password: string) =>
        POST(
          new NextRequest('http://localhost/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
            headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
          }),
        )

      // 9 failed sprays across different accounts from this IP (IP bucket → 9).
      for (let i = 0; i < 9; i++) {
        expect((await attempt(`ips-${i}@test.dev`, 'wrong')).status).toBe(401)
      }
      // A successful login from the same IP (IP bucket → 10) resets only the
      // account bucket — not the IP bucket.
      expect((await attempt('ipreset@test.dev', 'correct-pass')).status).toBe(200)
      // The next attempt from this IP is still blocked: the success did not
      // clear the accumulated per-IP failures.
      expect((await attempt('another@test.dev', 'whatever')).status).toBe(429)
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY
      else process.env.TRUST_PROXY = prev
    }
  })

  // Anti-DoS: without a trusted proxy the limiter is keyed per account, so a
  // burst of failures against one account must not block logins for others (a
  // single shared/global bucket would).
  it('failures against one account do not block a different account (no global bucket)', async () => {
    const prev = process.env.TRUST_PROXY
    delete process.env.TRUST_PROXY
    try {
      await createUser({ email: 'victim@test.dev', password: 'correct-pass' })
      await createUser({ email: 'bystander@test.dev', password: 'correct-pass' })
      const attempt = (email: string, password: string) => POST(makeRequest({ email, password }))

      for (let i = 0; i < 10; i++) {
        expect((await attempt('victim@test.dev', 'wrong-pass')).status).toBe(401)
      }
      expect((await attempt('victim@test.dev', 'correct-pass')).status).toBe(429)

      // A different account is unaffected — no shared bucket
      expect((await attempt('bystander@test.dev', 'correct-pass')).status).toBe(200)
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY
      else process.env.TRUST_PROXY = prev
    }
  })

  // NFA-05.1: spoofing defence — when TRUST_PROXY is NOT set, a client that
  // rotates X-Forwarded-For on every request must NOT be able to reset its
  // bucket. XFF is ignored, so all requests for this account share one key and
  // the limiter still fires.
  it('rotating X-Forwarded-For does not bypass the limiter when TRUST_PROXY is unset (NFA-05.1)', async () => {
    const prev = process.env.TRUST_PROXY
    delete process.env.TRUST_PROXY
    try {
      await createUser({ email: 'spoof@test.dev', password: 'correct-pass' })

      const spoofedAttempt = async (password: string) =>
        POST(
          new NextRequest('http://localhost/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: 'spoof@test.dev', password }),
            headers: {
              'content-type': 'application/json',
              // A fresh spoofed source IP on every call
              'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 254) + 1}`,
            },
          }),
        )

      // Enough failed attempts to fill the shared bucket (spoofing a new IP each
      // time). If XFF were trusted, each would be its own bucket and never trip.
      for (let i = 0; i < 10; i++) {
        await spoofedAttempt('wrong-pass')
      }

      // A further request — even with valid creds and yet another fresh spoofed
      // IP — is still blocked, proving the rotation did not reset the bucket.
      const blocked = await spoofedAttempt('correct-pass')
      expect(blocked.status).toBe(429)
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY
      else process.env.TRUST_PROXY = prev
    }
  })
})

// Issue #197. An administrator with no factor is signed in — enrolling needs a
// session — and told that is all this session may do.
describe('POST /api/auth/login — an administrator who owes a second factor', () => {
  it.each([['root'], ['admin']] as const)(
    'signs a %s in and flags the enrollment',
    async (role) => {
      const email = `owes-${role}@test.dev`
      await createUser({ email, password: 'correct-pass', role, secondFactor: false })

      const res = await POST(makeRequest({ email, password: 'correct-pass' }))
      expect(res.status).toBe(200)

      const body = await res.json()
      // A real token: without one they could not reach the enrollment endpoints,
      // and refusing the sign-in outright would be a lockout with no way back.
      expect(body.token).toBeDefined()
      expect(body.mustEnrollSecondFactor).toBe(true)
    },
  )

  it('omits the flag entirely once a factor is confirmed', async () => {
    // An enrolled administrator never reaches this path — they get a challenge —
    // so the flag has to be absent rather than false on every other response.
    await createUser({ email: 'no-flag@test.dev', password: 'correct-pass', role: 'project_manager' })
    const res = await POST(makeRequest({ email: 'no-flag@test.dev', password: 'correct-pass' }))
    expect(await res.json()).not.toHaveProperty('mustEnrollSecondFactor')
  })

  it('does not flag a project manager, who may not hold a factor at all', async () => {
    await createUser({ email: 'pm-login@test.dev', password: 'correct-pass', role: 'project_manager' })
    const res = await POST(makeRequest({ email: 'pm-login@test.dev', password: 'correct-pass' }))
    expect((await res.json()).mustEnrollSecondFactor).toBeUndefined()
  })
})
