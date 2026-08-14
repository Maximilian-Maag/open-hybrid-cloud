import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { verifyToken } from '@/lib/auth/jwt'
import { createUser } from '@/test/helpers'

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

describe('POST /api/auth/login', () => {
  it('returns a JWT token for valid credentials', async () => {
    await createUser({ email: 'login@test.dev', password: 'correct-pass', role: 'admin' })

    const res = await POST(makeRequest({ email: 'login@test.dev', password: 'correct-pass' }))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.token).toBeDefined()
    expect(body.user.email).toBe('login@test.dev')
    expect(body.user.role).toBe('admin')

    const session = await verifyToken(body.token)
    expect(session?.email).toBe('login@test.dev')
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
