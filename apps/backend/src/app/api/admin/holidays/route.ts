import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import {
  holidayFeedStatus, listHolidays, setHolidayFeedUrl, previewHolidayFeed,
  upsertManualHoliday, deleteHoliday, refreshHolidayFeed,
} from '@/lib/services/holidayFeed'

/**
 * The holiday table root maintains (#330). Root only, every verb.
 *
 * Which days the company does not deploy on is the same class of operational
 * statement as the windows themselves — see the deployment-windows route for
 * why reading is restricted as well as writing.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const PatchSchema = z.discriminatedUnion('action', [
  // Configure the feed. `null` clears it, which matters more than it looks:
  // a URL that has never read successfully stops the windows applying at all,
  // so there has to be a way back that is not the database.
  z.object({ action: z.literal('setFeed'), url: z.string().max(2048).nullable() }),
  // Fetch and parse without storing, so root sees the dates before committing.
  z.object({ action: z.literal('preview'), url: z.string().min(1).max(2048) }),
  // Pull now rather than waiting for the scheduler.
  z.object({ action: z.literal('refresh') }),
])

const UpsertSchema = z.object({
  date: z.string().regex(ISO_DATE, 'A holiday is a date, as YYYY-MM-DD'),
  name: z.string().min(1).max(200),
  // Unticking a public holiday the company works through is as much a decision
  // as adding a shutdown week, so it is a first-class field rather than a
  // delete.
  observed: z.boolean().default(true),
})

export async function GET(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const now = new Date()
  // From today: past holidays are history, and a list that opens on last
  // January is a list nobody scrolls.
  const from = now.toISOString().slice(0, 10)
  return NextResponse.json({
    feed: await holidayFeedStatus(now),
    holidays: await listHolidays(from),
  })
}

export async function PATCH(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  if (parsed.data.action === 'preview') {
    return toResponse(await previewHolidayFeed(parsed.data.url))
  }
  if (parsed.data.action === 'refresh') {
    const outcome = await refreshHolidayFeed(new Date())
    // Same reasoning as the scheduled route: a feed that is down is news, not a
    // server error, and the cached dates are untouched either way.
    return NextResponse.json(outcome.ok ? { refreshed: true, ...outcome.data } : { refreshed: false, error: outcome.error })
  }
  return toResponse(await setHolidayFeedUrl(parsed.data.url, session.id))
}

export async function PUT(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const parsed = UpsertSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  return toResponse(await upsertManualHoliday(parsed.data, session.id))
}

export async function DELETE(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const date = new URL(req.url).searchParams.get('date') ?? ''
  if (!ISO_DATE.test(date)) {
    return NextResponse.json({ error: 'A holiday is a date, as YYYY-MM-DD' }, { status: 400 })
  }
  return toResponse(await deleteHoliday(date, session.id))
}
