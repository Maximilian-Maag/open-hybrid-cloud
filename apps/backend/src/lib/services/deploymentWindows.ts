/**
 * When provisioning is allowed to run (#330).
 *
 * Root defines how many windows a day there are, when each starts and how long
 * it lasts. The same pattern every working day; weekends and holidays are out.
 * The point is that a deployment happens while admins are present to watch it,
 * so everything here is expressed in the operator's WALL CLOCK — "we are here
 * from 08:00" — not in elapsed time.
 *
 * Pure on purpose. Windows and holidays are passed in rather than read, so
 * every case below is testable without a clock or a database, and the two
 * questions the rest of the feature asks — "may this run now?" and "when may it
 * run?" — are the only two functions.
 *
 * No date library. The zone arithmetic is `Intl.DateTimeFormat`, which knows the
 * IANA rules, and the repo has no runtime date dependency to add one to.
 */

/** One window, as root configures it: a wall-clock start and a length. */
export interface DeploymentWindow {
  /** Minutes past local midnight. 08:00 is 480. */
  startMinute: number
  durationMinutes: number
}

export interface WindowPolicy {
  windows: DeploymentWindow[]
  /** IANA name, e.g. `Europe/Berlin`. Windows mean this zone's wall clock. */
  timeZone: string
  /** Non-working dates as `YYYY-MM-DD` in `timeZone`, from the holiday cache. */
  holidays: ReadonlySet<string>
}

/** A local wall-clock reading of an instant, in some zone. */
interface LocalReading {
  year: number
  month: number
  day: number
  /** 1 = Monday … 7 = Sunday, as ISO numbers them. */
  weekday: number
  minuteOfDay: number
}

const ISO_WEEKDAY: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
}

/**
 * A formatter per zone.
 *
 * Building one costs enough to matter when `nextWindowStart` walks a year of
 * days, and they are immutable, so they are made once.
 */
const formatters = new Map<string, Intl.DateTimeFormat>()

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatters.get(timeZone)
  if (cached) return cached
  const made = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
    hour12: false,
  })
  formatters.set(timeZone, made)
  return made
}

/** What a clock on the wall in `timeZone` reads at `at`. */
const readLocally = (at: Date, timeZone: string): LocalReading => {
  const parts = Object.fromEntries(
    formatterFor(timeZone).formatToParts(at).map((p) => [p.type, p.value]),
  ) as Record<string, string>

  // `hour12: false` still renders midnight as 24 in some ICU versions, which
  // would put minute-of-day past the end of the day it belongs to.
  const hour = Number(parts.hour) % 24

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: ISO_WEEKDAY[parts.weekday],
    minuteOfDay: hour * 60 + Number(parts.minute),
  }
}

/** `YYYY-MM-DD` for a reading, which is how holidays are keyed. */
const dateKey = (r: Pick<LocalReading, 'year' | 'month' | 'day'>): string =>
  `${r.year}-${String(r.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`

/** Saturday, Sunday and any cached holiday are out. */
const isWorkingDay = (r: LocalReading, holidays: ReadonlySet<string>): boolean =>
  r.weekday <= 5 && !holidays.has(dateKey(r))

/**
 * Whether `at` falls inside one of the windows.
 *
 * Membership is decided in wall-clock minutes of the local day, which is what
 * makes the DST answers the right ones without any special case:
 *
 *  - On the spring transition 02:00–03:00 does not exist, so a window there
 *    simply never matches. It fails CLOSED, which is the safe direction for a
 *    gate whose whole purpose is that somebody is watching.
 *  - On the autumn transition 02:00–03:00 happens twice, so such a window
 *    matches twice. Also right: an admin is at their desk on both passes.
 *
 * A window may not cross midnight — `validateWindows` refuses one that does —
 * so there is no wrap to handle here.
 */
export const isWithinWindow = (at: Date, policy: WindowPolicy): boolean => {
  const local = readLocally(at, policy.timeZone)
  if (!isWorkingDay(local, policy.holidays)) return false

  return policy.windows.some(
    (w) => local.minuteOfDay >= w.startMinute && local.minuteOfDay < w.startMinute + w.durationMinutes,
  )
}

/** Milliseconds `timeZone` is ahead of UTC at `at`. */
const offsetAt = (at: Date, timeZone: string): number => {
  const r = readLocally(at, timeZone)
  const asIfUtc = Date.UTC(r.year, r.month - 1, r.day, 0, 0) + r.minuteOfDay * 60_000
  // Seconds and milliseconds are not in the reading, so compare on the minute.
  return asIfUtc - Math.floor(at.getTime() / 60_000) * 60_000
}

/**
 * The instant at which a wall clock in `timeZone` reads this local time.
 *
 * Two passes: guess with the offset in force at the naive instant, then correct
 * using the offset actually in force at the guess. One correction is enough —
 * transitions are an hour, and the guess is never more than an offset away.
 *
 * A local time inside the spring gap does not exist. This returns the instant
 * just after the gap, which is when a wall clock next shows a time at or past
 * the one asked for — the answer a "next window start" wants.
 */
const instantOfLocal = (
  year: number, month: number, day: number, minuteOfDay: number, timeZone: string,
): Date => {
  const naive = Date.UTC(year, month - 1, day, 0, 0) + minuteOfDay * 60_000
  const firstGuess = new Date(naive - offsetAt(new Date(naive), timeZone))
  const corrected = new Date(naive - offsetAt(firstGuess, timeZone))
  return corrected
}

/** How far ahead to look before giving up. */
const MAX_DAYS_AHEAD = 366

/**
 * The first moment at or after `after` that falls in a window.
 *
 * `null` when there is none within a year — which means the configuration
 * cannot ever open, not that the caller should wait. Callers surface that
 * rather than queueing an order for ever.
 *
 * Days are walked rather than computed because a run of holidays, a weekend and
 * a DST change can all land in the same gap, and walking asks the same question
 * of each day instead of trying to be clever across them.
 */
export const nextWindowStart = (after: Date, policy: WindowPolicy): Date | null => {
  if (policy.windows.length === 0) return null
  const starts = [...policy.windows].sort((a, b) => a.startMinute - b.startMinute)

  for (let dayOffset = 0; dayOffset < MAX_DAYS_AHEAD; dayOffset++) {
    // Read the candidate day from an instant 24h apart rather than by adding to
    // a local date: adding days to a wall clock across a DST change drifts.
    const probe = new Date(after.getTime() + dayOffset * 86_400_000)
    const local = readLocally(probe, policy.timeZone)
    if (!isWorkingDay(local, policy.holidays)) continue

    for (const w of starts) {
      const candidate = instantOfLocal(local.year, local.month, local.day, w.startMinute, policy.timeZone)
      if (candidate.getTime() >= after.getTime()) return candidate
    }
  }
  return null
}

/**
 * What is wrong with a set of windows, or nothing.
 *
 * Validated as a SET, not one at a time: two windows that are each fine can
 * still overlap, and an overlap makes "which window am I in" unanswerable for
 * the audit trail.
 */
export const validateWindows = (windows: DeploymentWindow[]): string | null => {
  for (const w of windows) {
    if (!Number.isInteger(w.startMinute) || w.startMinute < 0 || w.startMinute > 1439) {
      return `A window must start within the day; got minute ${w.startMinute}`
    }
    if (!Number.isInteger(w.durationMinutes) || w.durationMinutes <= 0) {
      return `A window must last at least a minute; got ${w.durationMinutes}`
    }
    if (w.startMinute + w.durationMinutes > 1440) {
      // Refused rather than wrapped: a window over midnight is two windows on
      // two different days, and one of them may be a Saturday.
      return 'A window may not run past midnight; split it into one window per day'
    }
  }

  const sorted = [...windows].sort((a, b) => a.startMinute - b.startMinute)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    if (sorted[i].startMinute < prev.startMinute + prev.durationMinutes) {
      return 'Two windows overlap; merge them or move one'
    }
  }
  return null
}
