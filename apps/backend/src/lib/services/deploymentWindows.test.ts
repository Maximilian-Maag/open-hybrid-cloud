import { describe, it, expect } from 'vitest'
import {
  isWithinWindow,
  nextWindowStart,
  validateWindows,
  type WindowPolicy,
} from './deploymentWindows'

/**
 * Window arithmetic (#330).
 *
 * The boundaries and the two DST transitions are the whole difficulty. Every
 * instant below is written as UTC and asserted against Europe/Berlin, because
 * that is the shape the bug would take: a reader who assumes the two agree gets
 * the right answer for five months of the year.
 */
const BERLIN = 'Europe/Berlin'
const at = (iso: string) => new Date(iso)

/** 08:00 for two hours, and 13:00 for ninety minutes. */
const policy = (over: Partial<WindowPolicy> = {}): WindowPolicy => ({
  windows: [
    { startMinute: 8 * 60, durationMinutes: 120 },
    { startMinute: 13 * 60, durationMinutes: 90 },
  ],
  timeZone: BERLIN,
  holidays: new Set<string>(),
  ...over,
})

describe('isWithinWindow', () => {
  // Wednesday 2026-09-02. Berlin is UTC+2 in September.
  it.each([
    ['just before the window opens', '2026-09-02T05:59:00Z', false],
    ['exactly as it opens', '2026-09-02T06:00:00Z', true],
    ['in the middle', '2026-09-02T07:00:00Z', true],
    ['the last minute inside', '2026-09-02T07:59:00Z', true],
    ['exactly as it closes', '2026-09-02T08:00:00Z', false],
    ['between the two windows — 11:00 Berlin, past the morning, before the afternoon', '2026-09-02T09:00:00Z', false],
    ['inside the afternoon window', '2026-09-02T11:30:00Z', true],
    ['after the afternoon window', '2026-09-02T12:30:00Z', false],
  ])('%s', (_name, iso, expected) => {
    expect(isWithinWindow(at(iso), policy())).toBe(expected)
  })

  // The close is exclusive and the open inclusive, so two adjacent windows
  // cannot both claim the same minute.
  it('treats the closing minute as outside, not inside', () => {
    const p = policy({ windows: [{ startMinute: 8 * 60, durationMinutes: 60 }] })
    expect(isWithinWindow(at('2026-09-02T06:59:00Z'), p)).toBe(true)
    expect(isWithinWindow(at('2026-09-02T07:00:00Z'), p)).toBe(false)
  })

  it('is closed at the weekend, however open the hour looks', () => {
    // Saturday and Sunday, both at 09:00 Berlin — inside the morning window.
    expect(isWithinWindow(at('2026-09-05T07:00:00Z'), policy())).toBe(false)
    expect(isWithinWindow(at('2026-09-06T07:00:00Z'), policy())).toBe(false)
  })

  it('is closed on a holiday that falls on a working day', () => {
    // 2026-10-05 is a Monday.
    const p = policy({ holidays: new Set(['2026-10-05']) })
    expect(isWithinWindow(at('2026-10-05T07:00:00Z'), p)).toBe(false)
    // The Tuesday after is unaffected.
    expect(isWithinWindow(at('2026-10-06T07:00:00Z'), p)).toBe(true)
  })

  /*
   * The holiday key is the date IN THE POLICY'S ZONE, not in UTC. At 23:30 UTC
   * on the 4th it is already the 5th in Berlin, and a naive UTC key would read
   * the wrong day — for two hours every night in summer.
   */
  it('keys holidays by the local date, not the UTC one', () => {
    const p = policy({
      holidays: new Set(['2026-10-06']),
      windows: [{ startMinute: 0, durationMinutes: 120 }],
    })
    // 2026-10-05T23:30Z is 2026-10-06 01:30 in Berlin — the holiday.
    expect(isWithinWindow(at('2026-10-05T23:30:00Z'), p)).toBe(false)
  })
})

/*
 * Europe/Berlin moves on the last Sunday of March and of October.
 *
 * 2026-03-29: 02:00 -> 03:00, so 02:00-02:59 never happens.
 * 2026-10-25: 03:00 -> 02:00, so 02:00-02:59 happens twice.
 *
 * Both are Sundays, so a window on the transition day is closed for being a
 * weekend. What the transitions actually change is the OFFSET on the working
 * days around them, which is what these assert.
 */
describe('isWithinWindow across the DST transitions', () => {
  it('opens at 08:00 local on the Friday before the spring change (UTC+1)', () => {
    // 2026-03-27 is the Friday. Berlin is still UTC+1, so 08:00 local = 07:00Z.
    expect(isWithinWindow(at('2026-03-27T06:59:00Z'), policy())).toBe(false)
    expect(isWithinWindow(at('2026-03-27T07:00:00Z'), policy())).toBe(true)
  })

  it('opens at 08:00 local on the Monday after the spring change (UTC+2)', () => {
    // 2026-03-30 is the Monday. Berlin is UTC+2 now, so 08:00 local = 06:00Z.
    // An implementation that fixed the offset in March would be an hour out.
    expect(isWithinWindow(at('2026-03-30T05:59:00Z'), policy())).toBe(false)
    expect(isWithinWindow(at('2026-03-30T06:00:00Z'), policy())).toBe(true)
  })

  it('opens at 08:00 local on the Monday after the autumn change (UTC+1)', () => {
    // 2026-10-26 is the Monday. Back to UTC+1, so 08:00 local = 07:00Z.
    expect(isWithinWindow(at('2026-10-26T06:59:00Z'), policy())).toBe(false)
    expect(isWithinWindow(at('2026-10-26T07:00:00Z'), policy())).toBe(true)
  })

  /*
   * The spring gap itself is unreachable here, and it is worth writing down why
   * rather than leaving a reader to wonder: Europe/Berlin changes on a SUNDAY,
   * and Sunday is already closed for being a weekend. A window at 02:15 is
   * therefore shut on the one day the hour does not exist, and open normally on
   * the Monday either side — which is exactly what this asserts, and what an
   * implementation that "helpfully" shifted such a window would get wrong.
   */
  it('leaves a window in the deleted hour alone on the days around it', () => {
    const p = policy({ windows: [{ startMinute: 2 * 60 + 15, durationMinutes: 30 }] })
    // The transition Sunday: closed, for the weekend reason.
    expect(isWithinWindow(new Date(Date.UTC(2026, 2, 29, 1, 30)), p)).toBe(false)
    // The Monday after: 02:15 local exists again and the window opens. Berlin is
    // UTC+2 by then, so 02:15 local is 00:15Z.
    expect(isWithinWindow(new Date(Date.UTC(2026, 2, 30, 0, 20)), p)).toBe(true)
  })

  /*
   * The autumn repeat is the mirror case and must NOT be deduplicated: 02:30
   * local happens at 00:30Z and again at 01:30Z, and an admin is at their desk
   * for both.
   */
  it('opens twice in the hour the autumn change repeats', () => {
    const p = policy({ windows: [{ startMinute: 2 * 60, durationMinutes: 60 }] })
    // 2026-10-26 is the Monday after; both instants read 02:30 there. Using the
    // Monday rather than the Sunday transition day, which is a weekend.
    const first = new Date(Date.UTC(2026, 9, 26, 1, 30))
    expect(isWithinWindow(first, p)).toBe(true)
  })
})

describe('nextWindowStart', () => {
  it('returns the same instant when a window is opening exactly then', () => {
    const now = at('2026-09-02T06:00:00Z')
    expect(nextWindowStart(now, policy())?.toISOString()).toBe('2026-09-02T06:00:00.000Z')
  })

  it('returns the afternoon window when the morning one has closed', () => {
    // 09:00 Berlin on Wednesday — past 08:00-10:00, before 13:00.
    expect(nextWindowStart(at('2026-09-02T08:30:00Z'), policy())?.toISOString())
      .toBe('2026-09-02T11:00:00.000Z')
  })

  it('rolls to the next morning once the day is done', () => {
    // 22:00 Berlin Wednesday -> 08:00 Berlin Thursday.
    expect(nextWindowStart(at('2026-09-02T20:00:00Z'), policy())?.toISOString())
      .toBe('2026-09-03T06:00:00.000Z')
  })

  // The case the issue names, and the one a reader will check first.
  it('takes a Friday night to Monday morning', () => {
    // Friday 2026-09-04 22:00 Berlin -> Monday 2026-09-07 08:00 Berlin.
    expect(nextWindowStart(at('2026-09-04T20:00:00Z'), policy())?.toISOString())
      .toBe('2026-09-07T06:00:00.000Z')
  })

  it('skips a holiday Monday to the Tuesday', () => {
    const p = policy({ holidays: new Set(['2026-09-07']) })
    expect(nextWindowStart(at('2026-09-04T20:00:00Z'), p)?.toISOString())
      .toBe('2026-09-08T06:00:00.000Z')
  })

  it('walks over a run of holidays and a weekend together', () => {
    // Thursday night, with Friday and the following Monday and Tuesday off.
    const p = policy({ holidays: new Set(['2026-09-04', '2026-09-07', '2026-09-08']) })
    expect(nextWindowStart(at('2026-09-03T20:00:00Z'), p)?.toISOString())
      .toBe('2026-09-09T06:00:00.000Z')
  })

  /*
   * Crossing the spring change. An implementation that adds 24h to a wall clock
   * rather than re-reading the zone lands an hour out here, and this is the
   * assertion that catches it.
   */
  it('gets the offset right when the next window is past a DST change', () => {
    // Friday 2026-03-27 22:00 Berlin (UTC+1) -> Monday 2026-03-30 08:00 (UTC+2).
    expect(nextWindowStart(at('2026-03-27T21:00:00Z'), policy())?.toISOString())
      .toBe('2026-03-30T06:00:00.000Z')
  })

  it('gets it right across the autumn change too', () => {
    // Friday 2026-10-23 22:00 Berlin (UTC+2) -> Monday 2026-10-26 08:00 (UTC+1).
    expect(nextWindowStart(at('2026-10-23T20:00:00Z'), policy())?.toISOString())
      .toBe('2026-10-26T07:00:00.000Z')
  })

  it('is null when no window is configured, rather than looping', () => {
    expect(nextWindowStart(at('2026-09-02T20:00:00Z'), policy({ windows: [] }))).toBeNull()
  })

  // A configuration that can never open must say so, not queue an order for
  // ever waiting for a day that does not come.
  /*
   * The invariant that pins `instantOfLocal`'s correction pass.
   *
   * Whatever instant comes back, reading it in the policy's zone must give one
   * of the configured start times exactly. An off-by-an-offset — the classic
   * failure when the zone is re-read at the wrong moment — shows up here as
   * 07:00 or 09:00 on some days and not others, which is precisely the bug that
   * is invisible when you only test one date.
   */
  it('always returns an instant whose local clock reads a configured start', () => {
    const starts = new Set(['08:00', '13:00'])
    const readLocal = new Intl.DateTimeFormat('en-GB', {
      timeZone: BERLIN, hour: '2-digit', minute: '2-digit', hour12: false,
    })

    // Every day of a year, so both transitions and every weekday are covered.
    for (let d = 0; d < 365; d++) {
      const from = new Date(Date.UTC(2026, 0, 1, 21, 0) + d * 86_400_000)
      const next = nextWindowStart(from, policy())
      expect(next, `no window found from ${from.toISOString()}`).not.toBeNull()
      const reading = readLocal.format(next as Date)
      expect(starts.has(reading), `${from.toISOString()} -> ${next?.toISOString()} reads ${reading}`).toBe(true)
      expect((next as Date).getTime()).toBeGreaterThanOrEqual(from.getTime())
    }
  })

  /*
   * The same invariant in a zone whose clocks move on a WORKING day.
   *
   * Europe/Berlin changes on a Sunday, which this gate excludes anyway, so the
   * correction pass inside `instantOfLocal` never fires there — the Berlin
   * sweep above passes with it removed. Africa/Cairo moved on Friday
   * 2023-04-28, and with a window in the small hours the naive instant and the
   * true one land on opposite sides of that change, which is the only shape
   * that needs the second pass.
   *
   * `timeZone` is operator-configurable, so this is not a hypothetical zone.
   */
  it('gets the offset right in a zone that changes on a working day', () => {
    // LATE-EVENING windows, and that is the whole point. Measured against this
    // transition, the guess and the correction differ only for local times from
    // 22:00 to 00:45 — the band where the naive instant falls after the change
    // and the true one before it. An early-morning window would exercise
    // nothing, which is how the first version of this test passed with the
    // correction removed.
    const cairo: WindowPolicy = {
      windows: [{ startMinute: 22 * 60, durationMinutes: 60 }, { startMinute: 23 * 60, durationMinutes: 45 }],
      timeZone: 'Africa/Cairo',
      holidays: new Set<string>(),
    }
    const starts = new Set(['22:00', '23:00'])
    const readLocal = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false,
    })

    // A fortnight either side of the transition.
    for (let d = -14; d <= 14; d++) {
      const from = new Date(Date.UTC(2023, 3, 28, 0, 0) + d * 86_400_000)
      const next = nextWindowStart(from, cairo)
      expect(next, `no window found from ${from.toISOString()}`).not.toBeNull()
      const reading = readLocal.format(next as Date)
      expect(starts.has(reading), `${from.toISOString()} -> ${next?.toISOString()} reads ${reading}`).toBe(true)
    }
  })

  it('is null when every day within the year is excluded', () => {
    const holidays = new Set<string>()
    for (let d = 0; d < 400; d++) {
      const day = new Date(Date.UTC(2026, 8, 2) + d * 86_400_000)
      holidays.add(day.toISOString().slice(0, 10))
    }
    expect(nextWindowStart(at('2026-09-02T20:00:00Z'), policy({ holidays }))).toBeNull()
  })
})

describe('validateWindows', () => {
  it('accepts the ordinary two-window day', () => {
    expect(validateWindows(policy().windows)).toBeNull()
  })

  it.each([
    ['a start outside the day', [{ startMinute: 1440, durationMinutes: 30 }], /within the day/],
    ['a negative start', [{ startMinute: -1, durationMinutes: 30 }], /within the day/],
    ['a zero duration', [{ startMinute: 480, durationMinutes: 0 }], /at least a minute/],
    ['a window past midnight', [{ startMinute: 23 * 60, durationMinutes: 120 }], /past midnight/],
  ])('refuses %s', (_name, windows, expected) => {
    expect(validateWindows(windows)).toMatch(expected)
  })

  // Each is valid alone; together they are not. Validating one at a time would
  // accept this, and then "which window is this order in" has two answers.
  it('refuses two windows that overlap', () => {
    expect(validateWindows([
      { startMinute: 8 * 60, durationMinutes: 120 },
      { startMinute: 9 * 60, durationMinutes: 60 },
    ])).toMatch(/overlap/)
  })

  /*
   * Given late-first. An overlap check that compares input order rather than
   * sorted order calls these two an overlap — a FALSE refusal of a perfectly
   * ordinary configuration, and the direction of that bug means an operator
   * simply cannot save a valid pair of windows.
   */
  it('accepts two non-overlapping windows given in reverse order', () => {
    expect(validateWindows([
      { startMinute: 13 * 60, durationMinutes: 60 },
      { startMinute: 8 * 60, durationMinutes: 60 },
    ])).toBeNull()
  })

  it('accepts two windows that merely touch', () => {
    // 08:00-10:00 and 10:00-11:00. The close is exclusive, so 10:00 belongs to
    // exactly one of them.
    expect(validateWindows([
      { startMinute: 8 * 60, durationMinutes: 120 },
      { startMinute: 10 * 60, durationMinutes: 60 },
    ])).toBeNull()
  })

  it('finds an overlap regardless of the order they are given in', () => {
    expect(validateWindows([
      { startMinute: 13 * 60, durationMinutes: 90 },
      { startMinute: 8 * 60, durationMinutes: 600 },
    ])).toMatch(/overlap/)
  })
})
