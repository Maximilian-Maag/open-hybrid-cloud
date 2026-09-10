import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { POST } from './route'
import { db } from '@/lib/db/client'
import { holidays, holidayFeedState } from '@/lib/db/schema'

/**
 * The scheduled holiday refresh (#330).
 *
 * Same shape as the other internal routes: a shared secret in a header, 503
 * when it is unset, 401 on a mismatch. The one that differs is the failure
 * case — see the last test.
 */
const SECRET = 'holiday-refresh-secret-value'

const post = (secret?: string) =>
  new NextRequest('http://localhost/api/internal/holiday-refresh', {
    method: 'POST',
    headers: secret === undefined ? {} : { 'x-sweep-secret': secret },
  })

const ics = (date: string, name: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `DTSTART;VALUE=DATE:${date}`, `SUMMARY:${name}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')

let fetchSpy: ReturnType<typeof vi.spyOn> | undefined

const feedReturns = (body: string, ok = true) => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    status: ok ? 200 : 502,
    statusText: ok ? 'OK' : 'Bad Gateway',
    text: async () => body,
  } as unknown as Response)
}

beforeEach(() => {
  process.env.DEPLOYMENT_WINDOW_SWEEP_SECRET = SECRET
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  delete process.env.DEPLOYMENT_WINDOW_SWEEP_SECRET
  fetchSpy?.mockRestore()
  vi.restoreAllMocks()
})

describe('POST /api/internal/holiday-refresh', () => {
  // An unconfigured deployment must not be writable by an anonymous caller.
  it('is disabled with a 503 when no secret is configured', async () => {
    delete process.env.DEPLOYMENT_WINDOW_SWEEP_SECRET
    const res = await POST(post(SECRET))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain('DEPLOYMENT_WINDOW_SWEEP_SECRET')
  })

  it.each([
    ['no secret at all', undefined],
    ['the wrong secret', 'nope'],
    ['a prefix of the secret', SECRET.slice(0, 8)],
    ['the secret plus a suffix', `${SECRET}x`],
  ])('refuses %s with a 401', async (_name, secret) => {
    expect((await POST(post(secret))).status).toBe(401)
  })

  it('refreshes the cache and says what changed', async () => {
    await db.update(holidayFeedState).set({ url: 'https://feed.test/h.ics' }).where(eq(holidayFeedState.id, 1))
    feedReturns(ics('20261225', 'Christmas'))

    const res = await POST(post(SECRET))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ refreshed: true, added: 1 })
    expect(await db.select().from(holidays)).toHaveLength(1)
  })

  /*
   * 200, not 500, and the cached dates untouched.
   *
   * The refresh is best-effort by construction: replacing the cache with
   * nothing would turn "the feed is down" into "no day is a holiday". A
   * scheduler that saw a 5xx would retry, hammering a feed that is down for a
   * set of dates that has not changed — so the failure is reported in the body
   * and the age of the last good answer is what the admin UI shows.
   */
  it('reports a failed refresh as news rather than an error', async () => {
    await db.update(holidayFeedState).set({ url: 'https://feed.test/h.ics' }).where(eq(holidayFeedState.id, 1))
    feedReturns(ics('20261225', 'Christmas'))
    await POST(post(SECRET))
    fetchSpy?.mockRestore()
    feedReturns('<html>down</html>')

    const res = await POST(post(SECRET))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ refreshed: false })
    // The last good set is still there, which is the whole point.
    expect(await db.select().from(holidays)).toHaveLength(1)
  })
})
