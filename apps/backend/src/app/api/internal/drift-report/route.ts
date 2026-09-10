import { type NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { recordDriftReport } from '@/lib/services/driftReports'

/**
 * Where the scheduled drift pipeline reports what it found (#108).
 *
 * The direction is the design. #108 proposed the portal triggering a
 * `-refresh-only` pipeline per element every thirty minutes; a single scheduled
 * pipeline that walks the state backend and POSTs once needs no per-element
 * fan-out, no refresh-specific pipeline tracking, and no way to squeeze
 * `-detailed-exitcode`'s three outcomes through a pipeline status that only
 * carries success or failed. The script reads the exit code and says so here.
 *
 * Authenticated with a shared secret and disabled outright when it is unset,
 * the same shape as `decommission-sweep` — a scheduler has no user to be, and a
 * deployment that never configured one must not be writable by an anonymous
 * caller. Idempotent: the same report applied twice leaves the same rows.
 */

/**
 * What one state file's plan concluded.
 *
 * `locked` is a first-class outcome rather than an error. A refresh competing
 * with a live provisioning or teardown run for the same state file will fail on
 * the lock, and that is expected — it must be recorded as "could not check",
 * never as "no drift". `error` and `locked` therefore both leave any existing
 * drift alone rather than clearing it.
 */
const stateResult = z.object({
  stateKey: z.string().min(1).max(512),
  outcome: z.enum(['clean', 'drifted', 'locked', 'error']),
  summary: z
    .object({
      resources: z
        .array(z.object({ address: z.string().min(1).max(512), action: z.string().min(1).max(64) }))
        // A plan against a badly drifted state can list thousands of resources;
        // the portal shows a summary, not a plan, and an unbounded array here is
        // an unbounded jsonb column.
        .max(200),
    })
    .optional(),
})

const reportSchema = z.object({
  checkedAt: z.string().datetime(),
  // One report per run. Capped because this is unauthenticated-adjacent input
  // and the body is parsed into memory before anything else happens.
  results: z.array(stateResult).max(5000),
  /**
   * The run planned every entry of the work list it was given.
   *
   * Only a run that says so may have its silence read as "that state is no
   * longer being checked" — see the reconciliation in `recordDriftReport`. It is
   * stated by the runner rather than inferred here, because a job that died
   * halfway through looks identical from this side.
   */
  complete: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body is not JSON' }, { status: 400 })
  }

  const parsed = reportSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Malformed drift report', detail: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    )
  }

  const recorded = await recordDriftReport({
    checkedAt: new Date(parsed.data.checkedAt),
    results: parsed.data.results,
    complete: parsed.data.complete ?? false,
  })

  // The counts go back so the pipeline's own log says what the portal did with
  // its report — a run that matched nothing is a state-key convention that has
  // drifted apart, and it should be visible from either end.
  return NextResponse.json(recorded)
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
