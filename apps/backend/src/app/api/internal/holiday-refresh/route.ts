import { type NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { refreshHolidayFeed } from '@/lib/services/holidayFeed'

/**
 * Pull the holiday feed and cache what it says (#330).
 *
 * Scheduled, and authenticated the same way every other internal route is: a
 * shared secret in a header, 503 when it is unset. It reuses
 * DEPLOYMENT_WINDOW_SWEEP_SECRET rather than inventing a third one — this is
 * the same feature's other periodic job, run by whoever runs that sweep, and a
 * secret per endpoint is a secret somebody forgets to set.
 *
 * Daily is plenty. Public holidays are published a year ahead and move about as
 * often as the calendar does, and the whole design keeps them in the database
 * precisely so the decision path never waits on a third party's web server.
 *
 * A failed refresh answers 200, not 500. The refresh is best-effort by
 * construction — the cached dates stay exactly as they were, which is the point
 * — and a scheduler that retries on failure would hammer a feed that is down
 * for a set of dates that has not changed. The body says what happened, and the
 * admin UI shows the age of the last good answer.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.DEPLOYMENT_WINDOW_SWEEP_SECRET

  if (!expected) {
    return NextResponse.json(
      { error: 'Holiday refresh is not configured — set DEPLOYMENT_WINDOW_SWEEP_SECRET' },
      { status: 503 },
    )
  }

  const provided = req.headers.get('x-sweep-secret') ?? ''
  if (!constantTimeMatch(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const outcome = await refreshHolidayFeed(new Date())
  if (!outcome.ok) {
    // 200 with `refreshed: false`. See above: the cached dates are intact and a
    // retry would not help, so this is news rather than an error.
    return NextResponse.json({ refreshed: false, error: outcome.error })
  }
  return NextResponse.json({ refreshed: true, ...outcome.data })
}

/**
 * Compare without leaking the secret's length or a prefix match through timing.
 *
 * Hashed to a fixed width first, since timingSafeEqual throws on a length
 * mismatch — which would itself be an oracle for the length. The same guard the
 * other internal routes use, for the same reason.
 */
const constantTimeMatch = (provided: string, expected: string): boolean =>
  timingSafeEqual(
    createHash('sha256').update(provided, 'utf8').digest(),
    createHash('sha256').update(expected, 'utf8').digest(),
  )
