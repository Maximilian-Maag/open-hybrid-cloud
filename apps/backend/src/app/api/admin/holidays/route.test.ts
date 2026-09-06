import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { GET, PATCH, PUT, DELETE } from './route'
import { db } from '@/lib/db/client'
import { holidays, holidayFeedState } from '@/lib/db/schema'
import { createUser, makeAuthHeader } from '@/test/helpers'

/**
 * The holiday table root maintains (#330). Root only, every verb.
 */
const req = (method: string, body?: unknown, auth?: string, query = '') =>
  new NextRequest(`http://localhost/api/admin/holidays${query}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  })

const authAs = async (role: 'root' | 'admin' | 'project_manager') =>
  makeAuthHeader(await createUser({ role, email: `hol-${role}-${Math.random()}@test.dev` }))

const ics = (date: string, name: string) =>
  ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', `DTSTART;VALUE=DATE:${date}`, `SUMMARY:${name}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')

let fetchSpy: ReturnType<typeof vi.spyOn> | undefined
const feedReturns = (body: string) => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true, status: 200, statusText: 'OK', text: async () => body,
  } as unknown as Response)
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { fetchSpy?.mockRestore(); vi.restoreAllMocks() })

describe('/api/admin/holidays', () => {
  it('refuses an anonymous caller', async () => {
    expect((await GET(req('GET'))).status).toBe(401)
  })

  it.each(['admin', 'project_manager'] as const)('refuses %s on every verb', async (role) => {
    const auth = await authAs(role)
    expect((await GET(req('GET', undefined, auth))).status).toBe(403)
    expect((await PATCH(req('PATCH', { action: 'refresh' }, auth))).status).toBe(403)
    expect((await PUT(req('PUT', { date: '2026-12-25', name: 'X' }, auth))).status).toBe(403)
    expect((await DELETE(req('DELETE', undefined, auth, '?date=2026-12-25'))).status).toBe(403)
  })

  it('reports the feed status and the cached dates', async () => {
    await db.insert(holidays).values({ date: '2099-12-25', name: 'Christmas', source: 'feed' })
    const res = await GET(req('GET', undefined, await authAs('root')))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.feed).toMatchObject({ url: null, neverSucceeded: false })
    expect(body.holidays).toEqual([
      { date: '2099-12-25', name: 'Christmas', source: 'feed', observed: true },
    ])
  })

  // A list that opens on last January is a list nobody scrolls.
  it('lists from today onward, not the whole history', async () => {
    await db.insert(holidays).values([
      { date: '2000-01-01', name: 'Long ago', source: 'manual' },
      { date: '2099-12-25', name: 'Christmas', source: 'feed' },
    ])
    const body = await (await GET(req('GET', undefined, await authAs('root')))).json()
    expect(body.holidays.map((h: { date: string }) => h.date)).toEqual(['2099-12-25'])
  })

  it('previews a feed without storing anything', async () => {
    feedReturns(ics('20261225', 'Christmas'))
    const res = await PATCH(req('PATCH', { action: 'preview', url: 'https://feed.test/h.ics' }, await authAs('root')))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ date: '2026-12-25', name: 'Christmas' }])
    // Nothing written: that is the difference from `refresh`.
    expect(await db.select().from(holidays)).toHaveLength(0)
  })

  it('reports a bad feed at preview time rather than after saving it', async () => {
    feedReturns('<html>not a calendar</html>')
    const res = await PATCH(req('PATCH', { action: 'preview', url: 'https://feed.test/h.ics' }, await authAs('root')))
    expect(res.status).toBe(400)
  })

  it('sets and clears the feed url', async () => {
    const auth = await authAs('root')
    expect((await PATCH(req('PATCH', { action: 'setFeed', url: 'https://feed.test/h.ics' }, auth))).status).toBe(200)
    expect((await db.select().from(holidayFeedState))[0].url).toBe('https://feed.test/h.ics')

    /*
     * Clearing matters more than it looks: a URL that has never read
     * successfully stops the windows applying at all (the fail-closed rule), so
     * an operator who typed the wrong address needs a way back that is not the
     * database.
     */
    expect((await PATCH(req('PATCH', { action: 'setFeed', url: null }, auth))).status).toBe(200)
    expect((await db.select().from(holidayFeedState))[0].url).toBeNull()
  })

  it('refuses a feed url that is not http', async () => {
    const res = await PATCH(req('PATCH', { action: 'setFeed', url: 'file:///etc/passwd' }, await authAs('root')))
    expect(res.status).toBe(400)
  })

  it('adds a holiday by hand', async () => {
    const res = await PUT(req('PUT', { date: '2026-12-28', name: 'Company shutdown', observed: true }, await authAs('root')))

    expect(res.status).toBe(200)
    const [row] = await db.select().from(holidays).where(eq(holidays.date, '2026-12-28'))
    expect(row).toMatchObject({ name: 'Company shutdown', source: 'manual', observed: true })
  })

  /*
   * The other thing no feed can express. Unticking takes the row over as
   * `manual`, which is what stops the next refresh putting it back.
   */
  it('can mark a public holiday as one the company works through', async () => {
    await db.insert(holidays).values({ date: '2026-12-28', name: 'Bank Holiday', source: 'feed' })

    await PUT(req('PUT', { date: '2026-12-28', name: 'Bank Holiday', observed: false }, await authAs('root')))

    const [row] = await db.select().from(holidays).where(eq(holidays.date, '2026-12-28'))
    expect(row).toMatchObject({ source: 'manual', observed: false })
  })

  it('refuses a date that is not a date', async () => {
    expect((await PUT(req('PUT', { date: '25.12.2026', name: 'X' }, await authAs('root')))).status).toBe(400)
  })

  it('deletes one, and 404s for one that is not there', async () => {
    const auth = await authAs('root')
    await db.insert(holidays).values({ date: '2026-12-28', name: 'Shutdown', source: 'manual' })

    expect((await DELETE(req('DELETE', undefined, auth, '?date=2026-12-28'))).status).toBe(200)
    expect(await db.select().from(holidays)).toHaveLength(0)
    expect((await DELETE(req('DELETE', undefined, auth, '?date=2026-12-28'))).status).toBe(404)
  })
})
