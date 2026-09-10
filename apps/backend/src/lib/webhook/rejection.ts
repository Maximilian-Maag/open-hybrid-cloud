import { type NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/auth/requestMeta'

/**
 * Refuse a CI callback, out loud (issue #211).
 *
 * A rejected callback used to return 401 and log nothing. That is the most
 * consequential silence in this system: the callback is the only thing that ever
 * moves an order out of 'provisioning', nothing retries it, nothing polls, and
 * the CI provider does not resend. So one refused request stalls a deployment
 * permanently — and from inside the product it is indistinguishable from "CI never
 * called back", which sends whoever is debugging to the CI system, the network and
 * the proxy before the portal.
 *
 * It happened for real: after migration 0025 rotated the reused callback secrets,
 * hcp-dev refused 36 consecutive callbacks. The only trace was in the nginx access
 * log. Four orders are still stuck because of it.
 *
 * What is logged, and what is not:
 *
 *  - the provider and the reason, because they say which credential to look at
 *  - the source address, because "is this even GitLab" is the first question
 *  - the pipeline id when the body carries one, because it identifies the stalled
 *    order without a database lookup
 *  - NEVER the presented token or signature. A secret in a log file is a secret
 *    in whatever ships that log file, and knowing it was wrong is enough.
 *
 * The message names the overwhelmingly likely cause. Whoever reads it will not
 * have the issue open, and "Invalid token" on its own has already cost one
 * afternoon.
 */
export interface CallbackRejection {
  provider: 'gitlab' | 'github' | 'bitbucket'
  /** What the response says, and what the log leads with. */
  reason: string
  status?: number
  /** Present when the body parsed far enough to identify the run. */
  pipelineId?: string
}

export const rejectCallback = (req: NextRequest, rejection: CallbackRejection): NextResponse => {
  const { provider, reason, status = 401, pipelineId } = rejection
  console.error(
    `[webhook] REJECTED ${provider} callback: ${reason}.`,
    `from=${clientIp(req) ?? 'unknown'}`,
    pipelineId ? `pipeline=${pipelineId}` : '',
    '— the order this belongs to will stay in provisioning until a callback is accepted.',
    'Most often the environment\'s callback secret was rotated (migration 0025) and the new',
    'value has not been copied into the CI system: reveal it under Admin → Environments and',
    'paste it into the project\'s webhook.',
  )
  return NextResponse.json({ error: reason }, { status })
}
