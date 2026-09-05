import { type NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { driftTargets } from '@/lib/services/driftReports'

/**
 * The work list for the scheduled drift pipeline (#108).
 *
 * `plan -refresh-only` needs the template and the variables the apply used; a
 * state file says neither. So the pipeline asks, plans, and POSTs its findings
 * back to `/api/internal/drift-report`.
 *
 * Same secret and the same 503-when-unset rule as the report endpoint — they are
 * two halves of one conversation with one caller, and configuring one without
 * the other is not a state worth supporting.
 *
 * What this hands out is worth being explicit about: it is the same variable set
 * provisioning already sends to CI for each of these elements, so it is not a
 * new class of exposure — but it is the whole estate in one response instead of
 * one order's worth. ACTIVE elements only, and nothing at all when the secret is
 * unset.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.DRIFT_REPORT_SECRET

  if (!expected) {
    return NextResponse.json(
      { error: 'Drift reporting is not configured — set DRIFT_REPORT_SECRET' },
      { status: 503 },
    )
  }

  const provided = req.headers.get('x-drift-secret') ?? ''
  if (!constantTimeMatch(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ targets: await driftTargets() })
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
