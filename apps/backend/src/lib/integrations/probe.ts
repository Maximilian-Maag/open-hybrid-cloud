import type { IntegrationAuthType, IntegrationKind } from '@/lib/db/schema'

/**
 * Reachability probe for a registered integration (issue #111).
 *
 * An integration that is silently unreachable is worse than none, so every kind
 * has to be able to answer "did this work, and when". The shape here is
 * deliberately a thin per-kind switch over a shared request: what #111 asks for
 * is the substrate, not six API clients. Each of #112–#117 replaces its own
 * branch with a real client when it lands, and none of them has to re-decide
 * how a health result is stored or reported.
 */

/** What the probe needs; a subset of the row, so a caller can pass a fixture. */
export interface ProbeTarget {
  kind: IntegrationKind
  baseUrl: string
  authType: IntegrationAuthType
  username: string
  /** Decrypted. The probe never sees the envelope. */
  credential: string | null
}

export interface ProbeResult {
  ok: boolean
  /** HTTP status, or null when the request never got an answer. */
  status: number | null
  /** Present only on failure, and suitable for `integrations.last_error`. */
  error?: string
  /**
   * Anything the endpoint said that is worth showing, e.g. Foreman's version.
   * Free-form on purpose: it is diagnostic output, not a contract.
   */
  detail?: string
}

/**
 * Health endpoint per kind.
 *
 * These are the vendors' own unauthenticated-or-cheap status endpoints, chosen
 * so a probe cannot have side effects. A probe that listed hosts would be both
 * slow and a write-shaped call against a system the portal is only checking on.
 */
const HEALTH_PATHS: Record<IntegrationKind, string> = {
  foreman: '/api/v2/status',
  // AWX / Automation Controller. The trailing slash matters: without it AWX
  // answers 301 to the slashed form, and a redirect-following probe would report
  // success for a URL that is one hop off.
  ansible: '/api/v2/ping/',
  nexus: '/service/rest/v1/status',
  pulp: '/pulp/api/v3/status/',
  loki: '/ready',
  grafana: '/api/health',
}

/**
 * How long to wait. Short on purpose: this runs behind an admin request, and the
 * useful answer to "is Foreman up" after ten seconds is "no".
 */
const PROBE_TIMEOUT_MS = 5_000

/**
 * Reject anything that is not plain HTTP(S) before it reaches `fetch`.
 *
 * The base URL is operator-supplied, and `fetch` would happily accept `file:` or
 * a `data:` URL. Mirrors the same guard in lib/ci/gitlab.ts.
 */
const probeUrl = (baseUrl: string, path: string): URL => {
  // Concatenated, not `new URL(path, base)`: the health paths are absolute, and
  // the two-argument form would discard the base's own path — so a Foreman
  // mounted at https://gw.example.com/foreman would be probed at the gateway
  // root. Trailing slashes are stripped first, because `//api/v2/status` is a
  // 404 on Nexus and Pulp.
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}${path}`)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Disallowed URL protocol: ${url.protocol}`)
  }
  return url
}

const authHeaders = (target: ProbeTarget): Record<string, string> => {
  const credential = target.credential ?? ''
  switch (target.authType) {
    case 'none':
      return {}
    case 'bearer':
      return { Authorization: `Bearer ${credential}` }
    case 'basic':
      return {
        Authorization: `Basic ${Buffer.from(`${target.username}:${credential}`).toString('base64')}`,
      }
    case 'token_header':
      // Nexus and Pulp deployments behind a gateway commonly want a bare token
      // header rather than a scheme. Kept distinct from `bearer` so the stored
      // configuration says which one, instead of the operator smuggling
      // "Bearer x" into the credential itself.
      return { 'X-Auth-Token': credential }
  }
}

/**
 * Probe one integration.
 *
 * Never throws: a probe's job is to turn an unreachable system into a recorded
 * result, and a caller that has to try/catch around it will eventually forget.
 * Every failure — DNS, TLS, timeout, 500, bad protocol — comes back as
 * `{ ok: false, error }`.
 */
export const probeIntegration = async (target: ProbeTarget): Promise<ProbeResult> => {
  let url: URL
  try {
    url = probeUrl(target.baseUrl, HEALTH_PATHS[target.kind])
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? e.message : String(e) }
  }

  let res: Response
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json', ...authHeaders(target) },
      // Do not follow redirects: a 302 to a login page is the usual answer to a
      // bad credential, and following it would turn "unauthorised" into a 200
      // from an HTML page. `manual` makes that show up as the 3xx it is.
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
  } catch (e) {
    // AbortSignal.timeout rejects with a TimeoutError whose message is just
    // "The operation was aborted" — useless in `last_error`, so say what timed
    // out and after how long.
    const name = (e as { name?: string })?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, status: null, error: `No response within ${PROBE_TIMEOUT_MS} ms` }
    }
    return { ok: false, status: null, error: e instanceof Error ? e.message : String(e) }
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      // 401/403 is the single most common probe failure and means the stored
      // credential, not the system, so name it rather than leaving the operator
      // to look up the code.
      error:
        res.status === 401 || res.status === 403
          ? `Rejected the stored credential (HTTP ${res.status})`
          : `HTTP ${res.status} from ${url.pathname}`,
    }
  }

  return { ok: true, status: res.status, detail: await describe(target.kind, res) }
}

/**
 * Turn a successful response into something worth showing.
 *
 * Foreman is the one kind implemented properly, per #111: it reports its own
 * version at /api/v2/status, and knowing that the portal is talking to Foreman
 * 3.9 rather than 2.x is the difference between a working reconciliation (#112)
 * and a 404 on an endpoint that moved. The other five deliberately report
 * nothing beyond "reachable" until their own issue gives their response body a
 * meaning — inventing a parse for a body nobody consumes yet would be five
 * guesses to maintain.
 */
const describe = async (kind: IntegrationKind, res: Response): Promise<string | undefined> => {
  if (kind !== 'foreman') return undefined

  // A probe must not fail because the body was not the JSON we hoped for; the
  // status code already established reachability.
  const body = await res.json().catch(() => null)
  if (body === null || typeof body !== 'object') return undefined

  const { version, api_version: apiVersion } = body as { version?: unknown; api_version?: unknown }
  const parts: string[] = []
  if (typeof version === 'string') parts.push(`Foreman ${version}`)
  if (typeof apiVersion === 'number') parts.push(`API v${apiVersion}`)
  return parts.length > 0 ? parts.join(', ') : undefined
}
