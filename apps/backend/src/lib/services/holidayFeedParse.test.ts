import { describe, it, expect } from 'vitest'
import { parseHolidayFeed, HolidayFeedError } from './holidayFeedParse'

/**
 * Reading a holiday feed (#330).
 *
 * Pure, so every awkward shape is testable without a network. The cases that
 * matter are the ones where a wrong answer looks like a right one: a folded
 * line that silently drops a holiday, a recurring event taken as one date, an
 * empty result read as "no holidays this year".
 */
const ics = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n')

const event = (lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n')

describe('parseHolidayFeed — ICS', () => {
  it('reads a whole-day event', () => {
    const feed = ics(event(['DTSTART;VALUE=DATE:20261225', 'SUMMARY:Christmas Day']))
    expect(parseHolidayFeed(feed)).toEqual([{ date: '2026-12-25', name: 'Christmas Day' }])
  })

  /*
   * RFC 5545 folds anything past 75 octets onto a continuation line beginning
   * with a space. Not unfolding turns the tail into a property nothing
   * recognises — and because the rest of the event still parses, the holiday
   * quietly gets the wrong name, or the DTSTART is lost and the day becomes a
   * working day. The calendar looks fine either way.
   */
  it('unfolds a continuation line', () => {
    // Folded MID-WORD, which is what a 75-octet limit actually does and the
    // only way to prove the join is exact: the leading space is the fold
    // marker and must be dropped, not turned into a space in the name.
    const feed = ics(
      ['BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261003', 'SUMMARY:Tag der Deutschen Einh', ' eit', 'END:VEVENT'].join('\r\n'),
    )
    expect(parseHolidayFeed(feed)).toEqual([{ date: '2026-10-03', name: 'Tag der Deutschen Einheit' }])
  })

  it('unfolds a tab-continued line too', () => {
    const feed = ics(
      ['BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261003', 'SUMMARY:Tag der Deutschen Einh', '\teit', 'END:VEVENT'].join('\r\n'),
    )
    expect(parseHolidayFeed(feed)[0].name).toBe('Tag der Deutschen Einheit')
  })

  it('accepts a timed event, taking the day it starts on', () => {
    const feed = ics(event(['DTSTART:20261225T000000Z', 'SUMMARY:Christmas Day']))
    expect(parseHolidayFeed(feed)).toEqual([{ date: '2026-12-25', name: 'Christmas Day' }])
  })

  /*
   * Taking DTSTART alone would mark one Christmas a holiday and leave every
   * later one a working day — a wrong answer wearing the shape of a right one.
   * Expanding the rule properly is a calendar library's job.
   */
  it('skips a recurring event rather than taking its first date', () => {
    const feed = ics(
      event(['DTSTART;VALUE=DATE:20261225', 'RRULE:FREQ=YEARLY', 'SUMMARY:Christmas Day']),
      event(['DTSTART;VALUE=DATE:20261226', 'SUMMARY:Boxing Day']),
    )
    expect(parseHolidayFeed(feed)).toEqual([{ date: '2026-12-26', name: 'Boxing Day' }])
  })

  it('unescapes the text escapes ICS requires', () => {
    const feed = ics(event(['DTSTART;VALUE=DATE:20260501', 'SUMMARY:May Day\\, observed']))
    expect(parseHolidayFeed(feed)[0].name).toBe('May Day, observed')
  })

  // One VEVENT per region is normal in a national calendar, and `date` is the
  // primary key of the table this lands in.
  it('keeps one entry per date', () => {
    const feed = ics(
      event(['DTSTART;VALUE=DATE:20261225', 'SUMMARY:Christmas (Bavaria)']),
      event(['DTSTART;VALUE=DATE:20261225', 'SUMMARY:Christmas (Berlin)']),
    )
    expect(parseHolidayFeed(feed)).toHaveLength(1)
  })

  it('returns them in date order however the calendar listed them', () => {
    const feed = ics(
      event(['DTSTART;VALUE=DATE:20261226', 'SUMMARY:Boxing Day']),
      event(['DTSTART;VALUE=DATE:20260101', 'SUMMARY:New Year']),
    )
    expect(parseHolidayFeed(feed).map((h) => h.date)).toEqual(['2026-01-01', '2026-12-26'])
  })

  it('names an event that has no summary rather than dropping it', () => {
    const feed = ics(event(['DTSTART;VALUE=DATE:20261225']))
    expect(parseHolidayFeed(feed)).toEqual([{ date: '2026-12-25', name: 'Holiday' }])
  })

  it('ignores an event with no usable date', () => {
    const feed = ics(
      event(['DTSTART;VALUE=DATE:not-a-date', 'SUMMARY:Nonsense']),
      event(['DTSTART;VALUE=DATE:20261225', 'SUMMARY:Christmas Day']),
    )
    expect(parseHolidayFeed(feed)).toEqual([{ date: '2026-12-25', name: 'Christmas Day' }])
  })
})

describe('parseHolidayFeed — JSON', () => {
  // Nager.Date's shape, which is what people actually point this at.
  it('reads the public-holiday API shape, preferring the local name', () => {
    const feed = JSON.stringify([
      { date: '2026-01-01', localName: 'Neujahr', name: "New Year's Day", countryCode: 'DE' },
    ])
    expect(parseHolidayFeed(feed)).toEqual([{ date: '2026-01-01', name: 'Neujahr' }])
  })

  it('falls back to the English name when there is no local one', () => {
    const feed = JSON.stringify([{ date: '2026-01-01', name: "New Year's Day" }])
    expect(parseHolidayFeed(feed)[0].name).toBe("New Year's Day")
  })

  it('trims a full timestamp down to its day', () => {
    const feed = JSON.stringify([{ date: '2026-01-01T00:00:00Z', name: 'New Year' }])
    expect(parseHolidayFeed(feed)[0].date).toBe('2026-01-01')
  })

  it('skips entries with no usable date rather than failing the refresh', () => {
    const feed = JSON.stringify([{ name: 'Undated' }, { date: '2026-01-01', name: 'New Year' }])
    expect(parseHolidayFeed(feed)).toHaveLength(1)
  })
})

describe('parseHolidayFeed — refusals', () => {
  /*
   * The refusal that matters most. An empty result would replace every cached
   * date with nothing and report success, and the portal would then deploy on
   * Christmas morning. A feed with genuinely no holidays is indistinguishable
   * from one that broke, so the safe reading keeps the last good set.
   */
  it.each([
    ['an empty body', ''],
    ['whitespace', '   \n  '],
    ['a calendar with no events', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR'],
    ['an empty JSON array', '[]'],
    ['a JSON array of undated things', '[{"name":"Undated"}]'],
  ])('refuses %s', (_name, body) => {
    expect(() => parseHolidayFeed(body)).toThrow(HolidayFeedError)
  })

  it('refuses something that is neither shape', () => {
    expect(() => parseHolidayFeed('<html><body>404 Not Found</body></html>')).toThrow(
      /neither an ICS calendar nor JSON/,
    )
  })

  it('refuses JSON that is not an array', () => {
    expect(() => parseHolidayFeed('{"holidays":[]}')).toThrow(/array/)
  })
})
