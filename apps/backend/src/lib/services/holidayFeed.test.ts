import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { holidays, holidayFeedState, auditLog } from '@/lib/db/schema'
import { refreshHolidayFeed, holidayFeedStatus, holidayGuard, STALE_AFTER_DAYS } from './holidayFeed'

/**
 * Caching the holiday feed, and what happens when it is not there (#330).
 *
 * The decision path never calls out, so a feed being down is staleness rather
 * than an outage. The cost of that trade is that stale data is invisible unless
 * something says so, and most of what is asserted here is the saying-so.
 */
const AT = new Date('2026-09-10T06:00:00.000Z')

const ics = (...events: [string, string][]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...events.flatMap(([date, name]) => ['BEGIN:VEVENT', `DTSTART;VALUE=DATE:${date}`, `SUMMARY:${name}`, 'END:VEVENT']),
    'END:VCALENDAR',
  ].join('\r\n')

const respondWith = (body: string, init: { ok?: boolean; status?: number } = {}) =>
  vi.fn(async () =>
    ({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      statusText: init.status === 404 ? 'Not Found' : 'OK',
      text: async () => body,
    }) as unknown as Response,
  ) as unknown as typeof fetch

const configureFeed = async (url: string | null) =>
  db.update(holidayFeedState).set({ url }).where(eq(holidayFeedState.id, 1))

const datesIn = async () =>
  (await db.select().from(holidays).orderBy(holidays.date)).map((h) => `${h.date}:${h.source}:${h.name}`)

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('refreshHolidayFeed', () => {
  it('caches what the feed returned', async () => {
    await configureFeed('https://feed.test/holidays.ics')

    const out = await refreshHolidayFeed(AT, respondWith(ics(['20261225', 'Christmas'], ['20261226', 'Boxing Day'])))

    expect(out).toMatchObject({ ok: true, data: { added: 2, removed: 0 } })
    expect(await datesIn()).toEqual(['2026-12-25:feed:Christmas', '2026-12-26:feed:Boxing Day'])
  })

  it('does nothing when no feed is configured', async () => {
    const out = await refreshHolidayFeed(AT, respondWith(ics(['20261225', 'Christmas'])))
    expect(out).toEqual({ ok: false, error: 'No holiday feed is configured' })
  })

  it('drops a date the feed no longer lists', async () => {
    await configureFeed('https://feed.test/holidays.ics')
    await refreshHolidayFeed(AT, respondWith(ics(['20261225', 'Christmas'], ['20261231', 'Withdrawn'])))

    await refreshHolidayFeed(AT, respondWith(ics(['20261225', 'Christmas'])))

    expect(await datesIn()).toEqual(['2026-12-25:feed:Christmas'])
  })

  /*
   * A manual row is a decision somebody made about THIS company — a shutdown
   * week no public calendar knows about. A refresh that discarded them would
   * undo that decision every night, silently.
   */
  it('leaves a manually added holiday alone', async () => {
    await configureFeed('https://feed.test/holidays.ics')
    await db.insert(holidays).values({ date: '2026-12-28', name: 'Company shutdown', source: 'manual' })

    const out = await refreshHolidayFeed(AT, respondWith(ics(['20261225', 'Christmas'])))

    expect(out).toMatchObject({ ok: true })
    expect(await datesIn()).toEqual(['2026-12-25:feed:Christmas', '2026-12-28:manual:Company shutdown'])
  })

  // Same reasoning one level down: root unticking a holiday the company works
  // through is a decision, and a nightly refresh must not reset it.
  it('does not re-observe a feed holiday root has unticked', async () => {
    await configureFeed('https://feed.test/holidays.ics')
    await refreshHolidayFeed(AT, respondWith(ics(['20261225', 'Christmas'])))
    await db.update(holidays).set({ observed: false }).where(eq(holidays.date, '2026-12-25'))

    await refreshHolidayFeed(AT, respondWith(ics(['20261225', 'Christmas'])))

    const [row] = await db.select().from(holidays).where(eq(holidays.date, '2026-12-25'))
    expect(row.observed).toBe(false)
  })

  /*
   * The failure that matters. Replacing the cached dates with nothing would
   * turn "the feed is down" into "no day is a holiday" — a portal deploying on
   * Christmas morning while reporting a successful refresh.
   */
  it.each(['the feed is unreachable', 'the feed answers 404', 'the feed returns rubbish'])(
    'keeps the last good set when %s',
    async (name) => {
    await configureFeed('https://feed.test/holidays.ics')
    await refreshHolidayFeed(AT, respondWith(ics(['20261225', 'Christmas'])))

    const broken =
      name === 'the feed is unreachable'
        ? ((() => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch)
        : name === 'the feed answers 404'
          ? respondWith('Not Found', { ok: false, status: 404 })
          : respondWith('<html>nope</html>')

    const later = new Date(AT.getTime() + 86_400_000)
    const out = await refreshHolidayFeed(later, broken)

    expect(out.ok).toBe(false)
    expect(await datesIn()).toEqual(['2026-12-25:feed:Christmas'])
    const status = await holidayFeedStatus(later)
    expect(status.lastError).not.toBeNull()
    // Still the ORIGINAL success: a failure does not move the clock forward.
    expect(status.lastSuccessAt?.toISOString()).toBe(AT.toISOString())
    },
  )

  it('clears a recorded error once the feed works again', async () => {
    await configureFeed('https://feed.test/holidays.ics')
    await refreshHolidayFeed(AT, respondWith('<html>nope</html>'))
    expect((await holidayFeedStatus(AT)).lastError).not.toBeNull()

    await refreshHolidayFeed(AT, respondWith(ics(['20261225', 'Christmas'])))

    const status = await holidayFeedStatus(AT)
    expect(status.lastError).toBeNull()
    expect(status.lastErrorAt).toBeNull()
  })

  it('refuses a feed URL that is not http', async () => {
    await configureFeed('file:///etc/passwd')
    const out = await refreshHolidayFeed(AT, respondWith('root:x:0:0'))
    expect(out).toMatchObject({ ok: false })
    if (!out.ok) expect(out.error).toContain('http or https')
  })

  it('audits a refresh that changed the set, and not one that did not', async () => {
    await configureFeed('https://feed.test/holidays.ics')
    await refreshHolidayFeed(AT, respondWith(ics(['20261225', 'Christmas'])))
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'holidays.refreshed'))).toHaveLength(1)

    // Same set again: nothing moved, so there is nothing to say.
    await refreshHolidayFeed(AT, respondWith(ics(['20261225', 'Christmas'])))
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'holidays.refreshed'))).toHaveLength(1)
  })
})

describe('holidayFeedStatus', () => {
  it('reports the age and calls an old answer stale', async () => {
    await configureFeed('https://feed.test/holidays.ics')
    await refreshHolidayFeed(AT, respondWith(ics(['20261225', 'Christmas'])))

    const soon = new Date(AT.getTime() + 5 * 86_400_000)
    expect(await holidayFeedStatus(soon)).toMatchObject({ ageDays: 5, stale: false, observedCount: 1 })

    const late = new Date(AT.getTime() + (STALE_AFTER_DAYS + 1) * 86_400_000)
    expect(await holidayFeedStatus(late)).toMatchObject({ stale: true })
  })

  it('has no age before the first success', async () => {
    await configureFeed('https://feed.test/holidays.ics')
    expect(await holidayFeedStatus(AT)).toMatchObject({ ageDays: null, stale: false, neverSucceeded: true })
  })
})

describe('holidayGuard', () => {
  /*
   * The fail-closed rule from #330. With a feed configured and never read, the
   * portal cannot tell a public holiday from a working day, so it must not
   * claim to be applying windows.
   */
  it('refuses while a configured feed has never been read', async () => {
    await configureFeed('https://feed.test/holidays.ics')
    expect(await holidayGuard()).toContain('never been read successfully')
  })

  it('allows once the feed has worked at least once', async () => {
    await configureFeed('https://feed.test/holidays.ics')
    await refreshHolidayFeed(AT, respondWith(ics(['20261225', 'Christmas'])))
    expect(await holidayGuard()).toBeNull()
  })

  /*
   * NOT fail-closed: a feed that worked once and is failing now has a last good
   * answer, and public holidays do not move often. Refusing here would take the
   * portal down every time somebody else's web server did.
   */
  it('allows while a feed that once worked is currently failing', async () => {
    await configureFeed('https://feed.test/holidays.ics')
    await refreshHolidayFeed(AT, respondWith(ics(['20261225', 'Christmas'])))
    await refreshHolidayFeed(new Date(AT.getTime() + 86_400_000), respondWith('<html>nope</html>'))

    expect(await holidayGuard()).toBeNull()
  })

  // A deployment that never configured one has said it does not want holiday
  // exclusion. Weekends still work.
  it('allows when no feed is configured at all', async () => {
    expect(await holidayGuard()).toBeNull()
  })
})
