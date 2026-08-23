import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Mock upsertSsoUser so this test doesn't need a real users row in the DB
// unless the test explicitly seeds one via a spy that hits the real service.
vi.mock('@/lib/services/auth', () => ({
  upsertSsoUser: vi.fn(),
}))

import { GET } from './route'
import { upsertSsoUser } from '@/lib/services/auth'
import { createUser } from '@/test/helpers'
import { verifyToken } from '@/lib/auth/jwt'
import { db } from '@/lib/db/client'
import { sessions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const mockedUpsert = vi.mocked(upsertSsoUser)

// Encode a claims object into a fake JWS (no signing) that `jose.decodeJwt`
// can extract claims from. decodeJwt performs no signature check.
const makeIdToken = (claims: Record<string, unknown>): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${header}.${payload}.signature-placeholder`
}

const callbackReq = (params: Record<string, string>) =>
  new NextRequest(`http://localhost/api/auth/callback?${new URLSearchParams(params).toString()}`)

const setEntraEnv = () => {
  vi.stubEnv('ENTRA_TENANT_ID', 'tenant-abc')
  vi.stubEnv('ENTRA_CLIENT_ID', 'client-def')
  vi.stubEnv('ENTRA_CLIENT_SECRET', 'client-secret')
  vi.stubEnv('ENTRA_REDIRECT_URI', 'https://portal.example.com/api/auth/callback')
  vi.stubEnv('FRONTEND_URL', 'https://portal.example.com')
}

describe('GET /api/auth/callback (Entra ID OIDC)', () => {
  beforeEach(() => {
    setEntraEnv()
    mockedUpsert.mockReset()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 400 when the code query parameter is missing', async () => {
    const res = await GET(callbackReq({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/missing code/i)
  })

  it('returns 500 when Entra ID env vars are not configured', async () => {
    vi.unstubAllEnvs() // wipe the beforeEach stubs
    const res = await GET(callbackReq({ code: 'abc' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/entra id not configured/i)
  })

  it('returns 502 when the Microsoft token exchange fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('bad_request', { status: 400 }))
    const res = await GET(callbackReq({ code: 'abc' }))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/token exchange failed/i)
  })

  it('returns 400 when the ID token lacks sub or email claim', async () => {
    const idToken = makeIdToken({ /* no sub */ name: 'Alice' })
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id_token: idToken }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const res = await GET(callbackReq({ code: 'abc' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/missing claims/i)
  })

  it('redirects with ?error=account_error when upsertSsoUser returns null (Root-only mode)', async () => {
    const idToken = makeIdToken({ sub: 's-1', email: 'a@example.com', name: 'Alice' })
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id_token: idToken }), { status: 200 }),
    )
    mockedUpsert.mockResolvedValue(null)

    const res = await GET(callbackReq({ code: 'abc' }))
    expect(res.status).toBe(307) // NextResponse.redirect default
    expect(res.headers.get('location')).toContain('/?error=account_error')
  })

  it('redirects with ?error=account_disabled when the user exists but is inactive', async () => {
    const idToken = makeIdToken({ sub: 's-2', email: 'b@example.com', name: 'Bob' })
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id_token: idToken }), { status: 200 }),
    )
    mockedUpsert.mockResolvedValue({ id: 42, email: 'b@example.com', name: 'Bob', role: 'admin', active: false })

    const res = await GET(callbackReq({ code: 'abc' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/?error=account_disabled')
  })

  it('happy path: opens a session, and redirects to FRONTEND_URL/?token=…', async () => {
    // A real users row, because since #37 the callback writes a session that
    // references it — an SSO login that could not be listed or revoked would be a
    // hole in the feature rather than a shortcut.
    const user = await createUser({ email: 'c@example.com', name: 'Carol', role: 'admin' })
    const idToken = makeIdToken({ sub: 's-3', email: 'c@example.com', name: 'Carol' })
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id_token: idToken }), { status: 200 }),
    )
    mockedUpsert.mockResolvedValue({ id: user.id, email: user.email, name: 'Carol', role: 'admin', active: true })

    const res = await GET(callbackReq({ code: 'abc' }))
    expect(res.status).toBe(307)
    const loc = res.headers.get('location')
    expect(loc).toMatch(/^https:\/\/portal\.example\.com\/\?token=/)
    // upsertSsoUser was called with the claim values
    expect(mockedUpsert).toHaveBeenCalledWith('s-3', 'c@example.com', 'Carol')

    const token = new URL(loc as string).searchParams.get('token') as string
    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(rows).toHaveLength(1)
    expect((await verifyToken(token))?.sid).toBe(rows[0].id)
    // The default lifetime, not "remember me": how long the user stays signed in
    // to the identity provider is the provider's business, not this callback's.
    expect(rows[0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(8 * 60 * 60 * 1000)
  })

  it('falls back to preferred_username when email claim is absent', async () => {
    const user = await createUser({ email: 'd@example.com', name: 'Dan', role: 'admin' })
    const idToken = makeIdToken({ sub: 's-4', preferred_username: 'd@example.com', name: 'Dan' })
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id_token: idToken }), { status: 200 }),
    )
    mockedUpsert.mockResolvedValue({ id: user.id, email: user.email, name: 'Dan', role: 'admin', active: true })

    const res = await GET(callbackReq({ code: 'abc' }))
    expect(res.status).toBe(307)
    expect(mockedUpsert).toHaveBeenCalledWith('s-4', 'd@example.com', 'Dan')
  })
})
