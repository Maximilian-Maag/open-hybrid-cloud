import { type NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { releaseDueScheduledOrders } from '@/lib/services/windowPolicy'

/**
 * Releases orders whose deployment window has opened (#330).
 *
 * An approved order that arrived outside a window sits in 'scheduled' with the
 * instant it may run. Nothing releases it on its own — the backend runs several
 * replicas under an HPA, so an in-process timer would fire once per replica and
 * provision the same order that many times.
 *
 * Same shape as `decommission-sweep`, for the same reasons: a shared secret
 * because a scheduler has no user to be, 503 when it is unset so an
 * unconfigured deployment cannot be swept by an anonymous caller, and an atomic
 * claim per order so two overlapping calls cannot both release one.
 *
 * WITHOUT a scheduler calling this, a scheduled order waits for ever. That is
 * worth saying twice — it is the same trap `decommission-sweep` has, and the
 * admin guide already warns about that one.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.DEPLOYMENT_WINDOW_SWEEP_SECRET

  if (!expected) {
    return NextResponse.json(
      { error: 'Deployment windows are not swept — set DEPLOYMENT_WINDOW_SWEEP_SECRET' },
      { status: 503 },
    )
  }

  const provided = req.headers.get('x-sweep-secret') ?? ''
  if (!constantTimeMatch(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await releaseDueScheduledOrders(new Date())

  if (result.failed.length > 0) {
    // The releases that worked still happened, so this is not a plain error —
    // but a scheduler that only ever sees 200 would never surface an order
    // whose provisioning is broken.
    console.error('[window-sweep] Some scheduled orders could not be released:', result.failed)
    return NextResponse.json(result, { status: 207 })
  }

  return NextResponse.json(result)
}

/**
 * Compare without leaking the secret's length or a prefix match through timing.
 *
 * Hashed to a fixed width first, since timingSafeEqual throws on a length
 * mismatch — which would itself be an oracle for the length. The reasoning is
 * `decommission-sweep`'s; this is the same guard on the same kind of endpoint.
 */
const constantTimeMatch = (provided: string, expected: string): boolean =>
  timingSafeEqual(
    createHash('sha256').update(provided, 'utf8').digest(),
    createHash('sha256').update(expected, 'utf8').digest(),
  )
