import { db } from '@/lib/db/client'
import { auditLog, users } from '@/lib/db/schema'
import { eq, and, gte, lte, ilike, sql } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'

export interface AuditFilters {
  userId?: number
  action?: string
  from?: string
  to?: string
}

export interface AuditRow {
  id: number | null
  userId: number | null
  userName: string | null
  action: string | null
  entityId: number | null
  details: string | null
  createdAt: Date | null
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** The `YYYY-MM-DD` a bare date is, and a full ISO timestamp begins with. */
const LEADING_DATE = /^(\d{4})-(\d{2})-(\d{2})/

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

/**
 * Whether `YYYY-MM-DD` names a day that exists.
 *
 * Written out rather than round-tripped through `Date`, because `Date` is what
 * cannot be trusted here — and `Date.UTC(year, ...)` maps years 0–99 onto 1900–1999,
 * so even the day-0-of-next-month trick would answer for the wrong century.
 */
const isRealCalendarDate = (year: number, month: number, day: number): boolean => {
  if (month < 1 || month > 12 || day < 1) return false
  const last = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]
  return day <= last
}

/**
 * A `from`/`to` filter value as an instant, or null when it is not a date.
 *
 * A bare `YYYY-MM-DD` is widened to cover the whole named day, so a single-day
 * range returns that day's entries rather than only those written exactly at
 * midnight — the convention `parseInfraFilters` and `parseCostFilters` follow.
 *
 * The calendar is checked before the `Date` is built, because `Date` normalises
 * rather than rejects: `new Date('2026-02-30T00:00:00.000Z')` is March 2nd and
 * `2026-13-01` is January 2027. Both parse, so both were accepted, and a filter
 * nobody could have meant answered 200 with the wrong range instead of 400.
 *
 * Exported so `parseAuditFilters` can validate a value through the very code that
 * will interpret it. `to` used to append `T23:59:59Z` unconditionally, so a full
 * ISO timestamp became an unparseable string and the bound was dropped without a
 * word (issue #143).
 */
export const auditBoundary = (raw: string, edge: 'start' | 'end'): Date | null => {
  const parts = LEADING_DATE.exec(raw)
  if (parts && !isRealCalendarDate(Number(parts[1]), Number(parts[2]), Number(parts[3]))) return null

  const iso = DATE_ONLY.test(raw)
    ? `${raw}T${edge === 'start' ? '00:00:00.000Z' : '23:59:59.999Z'}`
    : raw
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

const buildConditions = (filters: AuditFilters) => {
  const conditions = []
  if (filters.userId) conditions.push(eq(auditLog.userId, filters.userId))
  if (filters.action) conditions.push(ilike(auditLog.action, `%${filters.action}%`))
  if (filters.from) {
    const d = auditBoundary(filters.from, 'start')
    if (d) conditions.push(gte(auditLog.createdAt, d))
  }
  if (filters.to) {
    const d = auditBoundary(filters.to, 'end')
    if (d) conditions.push(lte(auditLog.createdAt, d))
  }
  return conditions
}

export const listAuditLog = async (
  filters: AuditFilters,
  page: number,
  pageSize = 50,
): Promise<Result<{ rows: AuditRow[]; total: number }>> => {
  const conditions = buildConditions(filters)
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined
  // The route rejects a malformed page/pageSize with a 400 (parseAuditFilters), so
  // this is belt and braces for any other caller: a NaN or a negative reaching
  // LIMIT/OFFSET is a syntax error from Postgres, i.e. an unhandled 500.
  const clampedPageSize = Math.min(Math.max(1, Math.trunc(pageSize) || 1), 200)
  const clampedPage = Math.max(1, Math.trunc(page) || 1)

  const [countResult, rows] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(auditLog)
      .where(whereClause),
    db
      .select({
        id: auditLog.id,
        userId: auditLog.userId,
        userName: users.name,
        action: auditLog.action,
        entityId: auditLog.entityId,
        details: auditLog.details,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.userId, users.id))
      .where(whereClause)
      .orderBy(sql`${auditLog.createdAt} DESC`)
      .limit(clampedPageSize)
      .offset((clampedPage - 1) * clampedPageSize),
  ])

  return ok({ rows: rows as AuditRow[], total: countResult[0]?.count ?? 0 })
}

/**
 * Ceiling on an export.
 *
 * The export had no LIMIT at all: one unfiltered GET on a mature installation
 * selected every audit row ever written, joined them to `users`, buffered them in
 * the route and — for `format=pdf` — laid every one of them out with pdfkit. That
 * is a denial of service any admin can trigger by accident. 50 000 rows is far
 * more than a compliance export needs in one go and still bounded; a longer
 * history is exported a date range at a time.
 */
export const AUDIT_EXPORT_MAX_ROWS = 50_000

/**
 * Every row matching `filters`, or a 413 when there are more than `maxRows`.
 *
 * Refusing is the point. The LIMIT alone silently handed back the OLDEST `maxRows`
 * as an ordinary `attachment; filename="audit.csv"` — a file with nothing in it
 * saying it stops short, filed as a complete compliance export while the most
 * recent entries, the ones an investigation is usually about, are the ones missing.
 * Truncation metadata was the alternative, and it only helps if every consumer
 * renders it; a CSV opened in a spreadsheet or a PDF printed and signed does not.
 * Nothing at all is safer than something that looks complete, and the caller can
 * act on the error: narrow the date range and take the history a period at a time.
 *
 * One row beyond the cap is fetched to tell "exactly at the cap" from "over it";
 * it is discarded either way. `maxRows` is a parameter so the boundary can be
 * tested without writing 50 001 rows.
 */
export const exportAuditLog = async (
  filters: AuditFilters,
  maxRows = AUDIT_EXPORT_MAX_ROWS,
): Promise<Result<AuditRow[]>> => {
  const conditions = buildConditions(filters)
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db
    .select({
      id: auditLog.id,
      userId: auditLog.userId,
      userName: users.name,
      action: auditLog.action,
      entityId: auditLog.entityId,
      details: auditLog.details,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(whereClause)
    .orderBy(sql`${auditLog.createdAt} ASC`)
    .limit(maxRows + 1)

  if (rows.length > maxRows) {
    return err(
      413,
      `This export matches more than ${maxRows.toLocaleString('en-US')} entries, which is more than one export can carry. Narrow it with the from/to filters — or the user and action filters — and take the history a period at a time.`,
    )
  }

  return ok(rows as AuditRow[])
}
