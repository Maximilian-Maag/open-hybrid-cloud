/**
 * Turning a holiday feed into dates (#330).
 *
 * Pure, and separate from the fetching for the same reason the window
 * arithmetic is separate from the database: every awkward case here — a folded
 * ICS line, a feed that is one long line, a date that is really a timestamp —
 * is testable without a network.
 *
 * Two shapes are accepted, because the two things people actually have are an
 * ICS calendar exported from Outlook or a public holiday API. Nager.Date is the
 * common one and its JSON is what the JSON branch is shaped around.
 */

export interface FeedHoliday {
  /** A local date, `YYYY-MM-DD`. Never an instant: a holiday is a day. */
  date: string
  name: string
}

export class HolidayFeedError extends Error {}

/** `20261225` or `2026-12-25`, and nothing else. */
const asDate = (raw: string): string | null => {
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const dashed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`
  return null
}

/**
 * Undo RFC 5545 line folding.
 *
 * A line longer than 75 octets is split and continued on the next one, which
 * begins with a single space or tab. Not unfolding turns a long SUMMARY into a
 * property nothing recognises, and the holiday silently disappears — the worst
 * failure this feature can have, because the calendar still looks fine.
 */
const unfold = (body: string): string[] => {
  const lines = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out: string[] = []
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

/** `DTSTART;VALUE=DATE:20261225` → name `DTSTART`, params `;VALUE=DATE`, value `20261225`. */
const splitProperty = (line: string): { name: string; params: string; value: string } | null => {
  const colon = line.indexOf(':')
  if (colon === -1) return null
  const left = line.slice(0, colon)
  const semi = left.indexOf(';')
  return {
    name: (semi === -1 ? left : left.slice(0, semi)).toUpperCase(),
    params: semi === -1 ? '' : left.slice(semi).toUpperCase(),
    value: line.slice(colon + 1),
  }
}

/** ICS text escaping: `\,` `\;` `\\` and `\n` are literal in a SUMMARY. */
const unescapeText = (v: string): string =>
  v.replace(/\\([\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c)).trim()

const parseIcs = (body: string): FeedHoliday[] => {
  const found: FeedHoliday[] = []
  let inEvent = false
  let date: string | null = null
  let name = ''
  let recurring = false

  for (const line of unfold(body)) {
    const upper = line.toUpperCase()
    if (upper.startsWith('BEGIN:VEVENT')) {
      inEvent = true; date = null; name = ''; recurring = false
      continue
    }
    if (upper.startsWith('END:VEVENT')) {
      /*
       * A recurring event is skipped rather than taken on its first date.
       *
       * Expanding an RRULE correctly is a calendar library's job, and taking
       * only DTSTART would mark one Christmas a holiday and leave every later
       * one a working day — a wrong answer that looks like a right one. Public
       * holiday feeds list dates explicitly; a feed that does not is one the
       * operator should hear about, which is what the count in the refresh
       * result is for.
       */
      if (inEvent && date && !recurring) found.push({ date, name: name || 'Holiday' })
      inEvent = false
      continue
    }
    if (!inEvent) continue

    const prop = splitProperty(line)
    if (!prop) continue
    if (prop.name === 'RRULE' || prop.name === 'RDATE') recurring = true
    if (prop.name === 'DTSTART') {
      // A whole-day event carries VALUE=DATE. A timed one is still usable — the
      // day it starts on is the holiday — so the leading date is taken either
      // way rather than the event being dropped.
      date = asDate(prop.value.split('T')[0])
    }
    if (prop.name === 'SUMMARY') name = unescapeText(prop.value)
  }
  return found
}

const parseJson = (body: string): FeedHoliday[] => {
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    throw new HolidayFeedError('The feed is neither an ICS calendar nor JSON')
  }
  if (!Array.isArray(data)) {
    throw new HolidayFeedError('Expected a JSON array of holidays')
  }

  const found: FeedHoliday[] = []
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    const date = typeof row.date === 'string' ? asDate(row.date.slice(0, 10)) : null
    if (!date) continue
    // `localName` first: Nager.Date puts the English name in `name` and the
    // one the country actually uses in `localName`, and this list is read by
    // whoever works there.
    const name =
      (typeof row.localName === 'string' && row.localName) ||
      (typeof row.name === 'string' && row.name) ||
      'Holiday'
    found.push({ date, name })
  }
  return found
}

/**
 * Parse a feed body into dates, whichever of the two shapes it is.
 *
 * Sniffed from the content rather than trusted from `Content-Type`: plenty of
 * static hosts serve an `.ics` as `text/plain`, and a feed that parses fine but
 * is refused on a header is an outage nobody can explain.
 */
export const parseHolidayFeed = (body: string): FeedHoliday[] => {
  const trimmed = body.trim()
  if (trimmed === '') throw new HolidayFeedError('The feed returned nothing')

  const holidays = trimmed.toUpperCase().includes('BEGIN:VCALENDAR')
    ? parseIcs(trimmed)
    : parseJson(trimmed)

  if (holidays.length === 0) {
    /*
     * Refused rather than accepted as "no holidays this year".
     *
     * An empty result would replace every cached date with nothing, and the
     * portal would deploy on Christmas morning while reporting a successful
     * refresh. A feed that genuinely has no holidays is indistinguishable from
     * one that broke, so the safe reading is the one that keeps the last good
     * set.
     */
    throw new HolidayFeedError('The feed parsed but contained no dated holidays')
  }

  // Deduplicated: an ICS with one VEVENT per region repeats a national holiday,
  // and `holidays.date` is the primary key.
  const byDate = new Map<string, FeedHoliday>()
  for (const h of holidays) if (!byDate.has(h.date)) byDate.set(h.date, h)
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
