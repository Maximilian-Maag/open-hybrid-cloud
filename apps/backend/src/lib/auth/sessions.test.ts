import { describe, it, expect, vi, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  DEFAULT_SESSION_TTL_SECONDS,
  REMEMBER_ME_SESSION_TTL_SECONDS,
  SESSION_MAX_TTL_SECONDS,
  SESSION_TOUCH_INTERVAL_MS,
  createSession,
  hashToken,
  sessionTtlSeconds,
  validateSession,
} from './sessions'
import { verifyToken } from './jwt'
import { db } from '@/lib/db/client'
import { sessions } from '@/lib/db/schema'
import { createUser } from '@/test/helpers'

afterEach(() => {
  vi.unstubAllEnvs()
})

const sessionUser = (id: number, email: string) =>
  ({ id, email, name: 'Test User', role: 'admin' }) as const

describe('sessionTtlSeconds', () => {
  it('is 8 h by default and 30 days with remember me', () => {
    expect(sessionTtlSeconds()).toBe(DEFAULT_SESSION_TTL_SECONDS)
    expect(DEFAULT_SESSION_TTL_SECONDS).toBe(8 * 60 * 60)
    expect(sessionTtlSeconds(true)).toBe(REMEMBER_ME_SESSION_TTL_SECONDS)
    expect(REMEMBER_ME_SESSION_TTL_SECONDS).toBe(30 * 24 * 60 * 60)
  })

  it('takes an operator override for each of the two lifetimes', () => {
    vi.stubEnv('SESSION_TTL_SECONDS', '3600')
    vi.stubEnv('SESSION_REMEMBER_ME_TTL_SECONDS', '604800')
    expect(sessionTtlSeconds()).toBe(3600)
    expect(sessionTtlSeconds(true)).toBe(604800)
  })

  it('clamps an override to the 30-day maximum from the issue', () => {
    // An operator who types a year by mistake should get a month, not a year.
    vi.stubEnv('SESSION_TTL_SECONDS', String(365 * 24 * 60 * 60))
    expect(sessionTtlSeconds()).toBe(SESSION_MAX_TTL_SECONDS)
  })

  it.each(['0', '-1', 'forever', '1.5', ''])('ignores a nonsense override (%s)', (raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('SESSION_TTL_SECONDS', raw)
    expect(sessionTtlSeconds()).toBe(DEFAULT_SESSION_TTL_SECONDS)
    warn.mockRestore()
  })
})

describe('hashToken', () => {
  it('is a stable SHA-256 hex digest', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
  })
})

describe('createSession', () => {
  it('writes a row whose hash matches the token, and a token naming the row', async () => {
    const user = await createUser({ email: 'cs-basic@test.dev', role: 'admin' })
    const created = await createSession({
      user: sessionUser(user.id, user.email),
      ip: '203.0.113.4',
      userAgent: 'Firefox',
    })

    const [row] = await db.select().from(sessions).where(eq(sessions.id, created.sessionId))
    expect(row.tokenHash).toBe(hashToken(created.token))
    expect(row.ip).toBe('203.0.113.4')
    expect(row.userAgent).toBe('Firefox')
    expect(row.revokedAt).toBeNull()
    expect((await verifyToken(created.token))?.sid).toBe(created.sessionId)
  })

  it('records ip and user agent as null when they are not known', async () => {
    const user = await createUser({ email: 'cs-null@test.dev' })
    const created = await createSession({ user: sessionUser(user.id, user.email) })
    const [row] = await db.select().from(sessions).where(eq(sessions.id, created.sessionId))
    expect(row.ip).toBeNull()
    expect(row.userAgent).toBeNull()
  })
})

describe('validateSession', () => {
  const open = async (email: string) => {
    const user = await createUser({ email })
    const created = await createSession({ user: sessionUser(user.id, user.email) })
    return { user, ...created }
  }

  it('accepts a live session and reports its owner', async () => {
    const { user, sessionId, token } = await open('vs-live@test.dev')
    expect(await validateSession(sessionId, token)).toEqual({ userId: user.id })
  })

  it('rejects a session id that does not exist', async () => {
    const { token } = await open('vs-missing@test.dev')
    expect(await validateSession(999_999, token)).toBeNull()
  })

  it('rejects a revoked session', async () => {
    const { sessionId, token } = await open('vs-revoked@test.dev')
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId))
    expect(await validateSession(sessionId, token)).toBeNull()
  })

  it('rejects an expired session, on the boundary as well as past it', async () => {
    const { sessionId, token } = await open('vs-expired@test.dev')
    const now = new Date()
    await db.update(sessions).set({ expiresAt: now }).where(eq(sessions.id, sessionId))
    // expires_at == now counts as over: a session with zero time left is not live.
    expect(await validateSession(sessionId, token, now)).toBeNull()
  })

  it('rejects a token that is not the one this session was opened with', async () => {
    const a = await open('vs-hash-a@test.dev')
    const b = await open('vs-hash-b@test.dev')
    expect(await validateSession(a.sessionId, b.token)).toBeNull()
  })

  it('does not write last_seen_at inside the touch interval', async () => {
    const { sessionId, token } = await open('vs-touch-skip@test.dev')
    const read = async () =>
      (await db.select({ lastSeenAt: sessions.lastSeenAt }).from(sessions).where(eq(sessions.id, sessionId)))[0]
        .lastSeenAt

    const before = await read()
    for (let i = 0; i < 5; i++) await validateSession(sessionId, token)
    expect((await read()).getTime()).toBe(before.getTime())
  })

  it('writes last_seen_at once the interval has passed', async () => {
    const { sessionId, token } = await open('vs-touch@test.dev')
    const stale = new Date(Date.now() - SESSION_TOUCH_INTERVAL_MS - 1000)
    await db.update(sessions).set({ lastSeenAt: stale }).where(eq(sessions.id, sessionId))

    const now = new Date()
    await validateSession(sessionId, token, now)

    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(row.lastSeenAt.getTime()).toBeGreaterThanOrEqual(now.getTime() - 1)
  })

  it('collapses a burst of concurrent requests into one touch', async () => {
    // The SQL predicate repeats the staleness check against the committed row, so
    // ten requests crossing the boundary together produce one write, not ten.
    const { sessionId, token } = await open('vs-touch-race@test.dev')
    const stale = new Date(Date.now() - SESSION_TOUCH_INTERVAL_MS - 1000)
    await db.update(sessions).set({ lastSeenAt: stale }).where(eq(sessions.id, sessionId))

    const results = await Promise.all(
      Array.from({ length: 10 }, () => validateSession(sessionId, token)),
    )
    expect(results.every((r) => r !== null)).toBe(true)

    const [row] = await db.select({ lastSeenAt: sessions.lastSeenAt }).from(sessions).where(eq(sessions.id, sessionId))
    expect(row.lastSeenAt.getTime()).toBeGreaterThan(stale.getTime())
  })
})
