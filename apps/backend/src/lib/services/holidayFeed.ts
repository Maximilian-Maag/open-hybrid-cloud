import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { holidays, holidayFeedState } from '@/lib/db/schema'
import { logAudit, logAuditWith } from '@/lib/audit'
import { parseHolidayFeed, HolidayFeedError, type FeedHoliday } from './holidayFeedParse'
import { ok, err, type Result } from '@/lib/services/result'

/**
 * Keeping the holiday table current (#330).
 *
 * The decision path never makes a network call. `whenMayItDeploy` reads the
 * `holidays` table, and this is the only thing that writes it — so a feed that
 * is down is staleness rather than an outage, and an order is never held up
 * waiting on somebody else's web server.
 *
 * That trade has a cost, and the cost is that stale data is invisible unless
 * something says so. Hence `holiday_feed_state`: when the feed last worked,
 * what went wrong if it did not, and — the part that matters — whether it has
 * EVER worked. See `holidayGuard`.
 */

/** How long a successful refresh stays trustworthy before the UI complains. */
export const STALE_AFTER_DAYS = 30

export interface RefreshOutcome {
  added: number
  removed: number
  unchanged: number
  /** Manual rows the refresh deliberately left alone. */
  keptManual: number
}

/**
 * Fetch the configured feed and replace the cached dates.
 *
 * Only `source = 'feed'` rows are replaced. A `manual` row is a decision
 * somebody made about this company — a shutdown week no public calendar knows
 * about, or a public holiday the company works through — and a refresh that
 * discarded those would quietly undo them every night.
 */
export const refreshHolidayFeed = async (
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; data: RefreshOutcome } | { ok: false; error: string }> => {
  const [state] = await db.select().from(holidayFeedState).where(eq(holidayFeedState.id, 1))
  const url = state?.url?.trim()
  if (!url) return { ok: false, error: 'No holiday feed is configured' }

  let parsed: FeedHoliday[]
  try {
    parsed = parseHolidayFeed(await fetchFeedBody(url, fetchImpl))
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    /*
     * The failure is recorded and the cached dates are left exactly as they
     * were. Replacing them with nothing would turn "the feed is down" into "no
     * day is a holiday", which is how a portal deploys on Christmas morning
     * while reporting a successful refresh.
     */
    await db
      .update(holidayFeedState)
      .set({ lastError: error, lastErrorAt: now })
      .where(eq(holidayFeedState.id, 1))
    return { ok: false, error }
  }

  const outcome = await applyFeed(parsed)

  await db
    .update(holidayFeedState)
    .set({ lastSuccessAt: now, lastError: null, lastErrorAt: null })
    .where(eq(holidayFeedState.id, 1))

  // Only when the set actually moved. A nightly refresh that changed nothing is
  // not news, and an audit log full of it is one nobody reads.
  if (outcome.added > 0 || outcome.removed > 0) {
    await logAudit(
      null,
      'holidays.refreshed',
      undefined,
      `Holiday feed refreshed: ${outcome.added} added, ${outcome.removed} removed, ` +
        `${outcome.unchanged} unchanged, ${outcome.keptManual} manual entries kept`,
    )
  }

  return { ok: true, data: outcome }
}

/** Only http(s), and a bounded read. */
const fetchFeedBody = async (url: string, fetchImpl: typeof fetch): Promise<string> => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new HolidayFeedError(`Not a URL: ${url}`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    // `file:` would read the container's filesystem into the holiday table.
    // Root configures this, but root configuring a URL should not be a way to
    // read files back out through the admin UI.
    throw new HolidayFeedError(`A holiday feed must be http or https, not ${parsed.protocol}`)
  }

  // A refresh is a background job; a feed that hangs must not hold a connection
  // open for ever, and the next scheduled run will try again anyway.
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { accept: 'text/calendar, application/json;q=0.9, */*;q=0.1' },
  })
  if (!response.ok) {
    throw new HolidayFeedError(`The feed answered ${response.status} ${response.statusText}`)
  }
  return await response.text()
}

/** Replace the `feed` rows with `parsed`, in one transaction, keeping `manual`. */
const applyFeed = async (parsed: FeedHoliday[]): Promise<RefreshOutcome> => {
  const dates = parsed.map((h) => h.date)

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ date: holidays.date, source: holidays.source })
      .from(holidays)
    const existingFeed = new Set(existing.filter((r) => r.source === 'feed').map((r) => r.date))
    const manual = new Set(existing.filter((r) => r.source === 'manual').map((r) => r.date))

    // Gone from the feed: a date that was moved or withdrawn. Manual rows are
    // never in this set, which is the whole point of the column.
    const removed = [...existingFeed].filter((d) => !dates.includes(d))
    if (removed.length > 0) {
      await tx.delete(holidays).where(and(eq(holidays.source, 'feed'), inArray(holidays.date, removed)))
    }

    let added = 0
    let unchanged = 0
    for (const h of parsed) {
      if (manual.has(h.date)) continue
      if (existingFeed.has(h.date)) unchanged += 1
      else added += 1
      await tx
        .insert(holidays)
        .values({ date: h.date, name: h.name, source: 'feed', observed: true })
        .onConflictDoUpdate({
          target: holidays.date,
          /*
           * `observed` is deliberately not overwritten.
           *
           * Root unticking a public holiday the company works through is a
           * decision about this company, and a refresh that reset it every
           * night would undo the decision silently — the same class of bug as
           * discarding a manual row, one level down.
           */
          set: { name: h.name },
          setWhere: eq(holidays.source, 'feed'),
        })
    }

    // Anything left over is a `manual` date the feed also happens to name; the
    // manual row wins and is counted so the operator can see it happened.
    const keptManual = parsed.filter((h) => manual.has(h.date)).length
    return { added, removed: removed.length, unchanged, keptManual }
  })
}

export interface HolidayFeedStatus {
  url: string | null
  lastSuccessAt: Date | null
  lastError: string | null
  lastErrorAt: Date | null
  /** Days since the last successful refresh; null if there has never been one. */
  ageDays: number | null
  stale: boolean
  /** No feed has ever succeeded while one is configured — see `holidayGuard`. */
  neverSucceeded: boolean
  observedCount: number
}

export const holidayFeedStatus = async (now: Date): Promise<HolidayFeedStatus> => {
  const [state] = await db.select().from(holidayFeedState).where(eq(holidayFeedState.id, 1))
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(holidays)
    .where(eq(holidays.observed, true))

  const url = state?.url?.trim() || null
  const lastSuccessAt = state?.lastSuccessAt ?? null
  const ageDays =
    lastSuccessAt === null ? null : Math.floor((now.getTime() - lastSuccessAt.getTime()) / 86_400_000)

  return {
    url,
    lastSuccessAt,
    lastError: state?.lastError ?? null,
    lastErrorAt: state?.lastErrorAt ?? null,
    ageDays,
    stale: ageDays !== null && ageDays > STALE_AFTER_DAYS,
    neverSucceeded: url !== null && lastSuccessAt === null,
    observedCount: n,
  }
}

/**
 * Whether the portal may honour a deployment window at all.
 *
 * `null` means yes. A string is the reason it may not, and the caller must then
 * refuse to schedule rather than deploy.
 *
 * This is the fail-closed rule from #330, and it is the one piece of the design
 * that is deliberately inconvenient. If a feed is configured and has NEVER
 * succeeded, the portal has no holiday data — so "outside a window" and "a
 * public holiday" are indistinguishable, and honouring windows would mean
 * deploying on Christmas morning while claiming the opposite. The promise the
 * feature makes cannot be kept, so it is not made.
 *
 * Note what is NOT fail-closed: a feed that worked once and is now failing, or
 * one that is stale. Those have a last good answer, which is very likely still
 * right — public holidays do not move often — and refusing on them would take
 * the portal down every time somebody else's web server did. The admin UI
 * complains instead.
 *
 * No feed configured at all is not a failure either. A deployment that never
 * set one has said it does not want holiday exclusion, and weekends still work.
 */
export const holidayGuard = async (): Promise<string | null> => {
  const [state] = await db.select().from(holidayFeedState).where(eq(holidayFeedState.id, 1))
  const url = state?.url?.trim()
  if (!url) return null
  if (state?.lastSuccessAt) return null

  return (
    'A holiday feed is configured but has never been read successfully, so the portal cannot tell ' +
    'a public holiday from a working day. Deployment windows are not being applied until it does. ' +
    (state?.lastError ? `Last error: ${state.lastError}` : 'It has not been tried yet.')
  )
}

/** One cached date, as the admin UI lists it. */
export interface HolidayRow {
  date: string
  name: string
  source: 'feed' | 'manual'
  observed: boolean
}

/** The cached dates from today onward — the past is history, not policy. */
export const listHolidays = async (from: string): Promise<HolidayRow[]> => {
  const rows = await db
    .select({
      date: holidays.date,
      name: holidays.name,
      source: holidays.source,
      observed: holidays.observed,
    })
    .from(holidays)
    .where(gte(holidays.date, from))
    .orderBy(holidays.date)
  return rows as HolidayRow[]
}

/**
 * Point the portal at a feed, or clear it.
 *
 * Clearing is not the same as leaving it unset and never mattered until the
 * fail-closed rule existed: a URL with no successful read blocks the windows
 * entirely, so an operator who typed the wrong address needs a way back that
 * does not involve the database.
 */
export const setHolidayFeedUrl = async (url: string | null, actorId: number): Promise<Result<null>> => {
  const trimmed = url?.trim() || null
  if (trimmed) {
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return err(400, `Not a URL: ${trimmed}`)
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return err(400, `A holiday feed must be http or https, not ${parsed.protocol}`)
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(holidayFeedState)
      // The error is cleared with the URL: it described the old address, and
      // leaving it would have the admin UI complain about a feed nobody uses.
      .set({ url: trimmed, lastError: null, lastErrorAt: null })
      .where(eq(holidayFeedState.id, 1))
    await logAuditWith(
      tx,
      actorId,
      'holidays.feed_changed',
      undefined,
      trimmed ? `Holiday feed set to ${trimmed}` : 'Holiday feed cleared',
    )
  })
  return ok(null)
}

/**
 * Fetch and parse a feed WITHOUT storing anything.
 *
 * Root pastes a URL and sees the dates before committing to them. Worth its own
 * path rather than "save and see what happens", because saving a bad URL is
 * what triggers the fail-closed rule — the portal stops applying windows until
 * a read succeeds, and the operator has to work out why from an error message.
 */
export const previewHolidayFeed = async (
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<FeedHoliday[]>> => {
  try {
    return ok(parseHolidayFeed(await fetchFeedBody(url, fetchImpl)))
  } catch (e) {
    return err(400, e instanceof Error ? e.message : String(e))
  }
}

/**
 * Add or amend a date by hand.
 *
 * Two things this expresses that no public feed can: a company shutdown week,
 * and a public holiday this company works through (`observed: false`). Both are
 * decisions about THIS company, which is why `source` is stamped 'manual' and
 * the refresh leaves those rows alone.
 */
export const upsertManualHoliday = async (
  input: { date: string; name: string; observed: boolean },
  actorId: number,
): Promise<Result<null>> => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return err(400, `A holiday is a date, as YYYY-MM-DD; got "${input.date}"`)
  }
  if (input.name.trim() === '') return err(400, 'A holiday needs a name')

  await db.transaction(async (tx) => {
    await tx
      .insert(holidays)
      .values({ date: input.date, name: input.name.trim(), source: 'manual', observed: input.observed })
      .onConflictDoUpdate({
        target: holidays.date,
        // Takes over a feed row rather than refusing: unticking a public holiday
        // the company works through is exactly this operation, and the row it
        // has to change is the one the feed wrote.
        set: { name: input.name.trim(), source: 'manual', observed: input.observed },
      })
    await logAuditWith(
      tx,
      actorId,
      'holidays.edited',
      undefined,
      `${input.date} ${input.name.trim()} — ${input.observed ? 'observed' : 'worked through'}`,
    )
  })
  return ok(null)
}

/**
 * Remove a date.
 *
 * A feed row deleted here comes back on the next refresh, and that is correct:
 * the feed is the source for those. To stop observing one, set `observed` to
 * false instead — which is why the UI offers that and not only a delete.
 */
export const deleteHoliday = async (date: string, actorId: number): Promise<Result<null>> => {
  const [removed] = await db.delete(holidays).where(eq(holidays.date, date)).returning({ date: holidays.date })
  if (!removed) return err(404, 'No such holiday')
  await logAudit(actorId, 'holidays.edited', undefined, `${date} removed`)
  return ok(null)
}
