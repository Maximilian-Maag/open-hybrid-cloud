import { type NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { sweepDueDecommissions } from '@/lib/services/infrastructure'

/**
 * Tear down every element whose scheduled decommission time has arrived
 * (issue #30).
 *
 * Driven by an external scheduler rather than an in-process timer: the backend is
 * a horizontally scaled Next.js app, so an interval would run once per replica.
 * See infra/helm/.../decommission-sweep-cronjob.yaml for the Kubernetes CronJob,
 * and .env.example for the plain-cron equivalent.
 *
 * Authenticated with a shared secret instead of a user session — a scheduler has
 * no user to be. The endpoint is disabled outright when the secret is unset, so a
 * deployment that never configured one cannot be swept by an unauthenticated
 * caller. Idempotent: the underlying claim means a replayed or overlapping call
 * tears nothing down twice.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.DECOMMISSION_SWEEP_SECRET

  if (!expected) {
    return NextResponse.json(
      { error: 'Scheduled decommissioning is not configured — set DECOMMISSION_SWEEP_SECRET' },
      { status: 503 },
    )
  }

  const provided = req.headers.get('x-sweep-secret') ?? ''
  if (!constantTimeMatch(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await sweepDueDecommissions()

  if (result.failed.length > 0) {
    // The successes still happened, so this is not a plain error — but a
    // scheduler that only ever sees 200 would never surface a product whose
    // destroy triggers are broken.
    console.error('[sweep] Some scheduled decommissions could not be started:', result.failed)
    return NextResponse.json(result, { status: 207 })
  }

  return NextResponse.json(result)
}

/**
 * Compare without leaking the secret's length or a prefix match through timing.
 * Both sides are hashed to a fixed width first, since timingSafeEqual throws on a
 * length mismatch — which would itself be an oracle for the length.
 */
const constantTimeMatch = (provided: string, expected: string): boolean => {
  const a = Buffer.from(provided.padEnd(128, '\0').slice(0, 128), 'utf8')
  const b = Buffer.from(expected.padEnd(128, '\0').slice(0, 128), 'utf8')
  return timingSafeEqual(a, b) && provided.length === expected.length
}
