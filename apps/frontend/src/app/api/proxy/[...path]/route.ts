import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '@/lib/auth'

/**
 * The browser's only way to reach the backend API (issue #146).
 *
 * Before this, the backend JWT was handed to the browser twice over: the session
 * callback put it on `session.apiToken`, so anything on the origin could read it
 * with `fetch('/api/auth/session')`, and server components passed it as a
 * `token={token}` prop into ~30 client components, which React serialises into
 * the inline RSC payload of every dashboard page. Either one turns any XSS on
 * this origin into 24 hours of full API access as that user — a bearer token is
 * not scoped to an origin, so it also survives being exfiltrated and replayed
 * from anywhere.
 *
 * The token now stays on the server. A client component calls `/api/proxy/...`
 * with the NextAuth session cookie — HttpOnly, so script cannot read it — and
 * this route attaches the Authorization header out of the session before
 * forwarding. What the browser holds is a cookie it cannot read, which is the
 * whole point.
 *
 * ── What this is deliberately NOT ────────────────────────────────────────────
 * It is not a general forwarder. The upstream is `API_URL`, fixed in the server
 * environment and never taken from the request, and the path is rebuilt from the
 * matched segments rather than passed through — so nothing a caller sends can
 * redirect this at another host. Nor is it a place to make authorisation
 * decisions: the backend still checks the role and the ownership of every object
 * on every request, exactly as it did when the browser held the token. This only
 * changes WHERE the credential lives.
 */
const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/**
 * Request headers copied through, lowercase.
 *
 * An allowlist rather than "everything except a few": `Authorization` and
 * `Cookie` are the two that must never be forwarded — the first because this
 * route is the only thing entitled to set it, and letting a caller supply one
 * would make the proxy a way to replay someone else's token through this
 * origin's server; the second because the backend has no use for a NextAuth
 * cookie and forwarding credentials nobody asked for is how they end up in a log.
 * A deny-list would have to be re-checked every time a header is invented.
 */
const FORWARD_REQUEST_HEADERS = ['content-type', 'accept', 'accept-language']

/**
 * Response headers copied back.
 *
 * `content-disposition` is load-bearing and easy to miss: the cost, audit and
 * infrastructure exports are fetched as blobs precisely so the token never lands
 * in a URL, and the filename comes back in this header.
 */
const FORWARD_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'content-length']

/** A 401 the browser can act on, rather than the login page's HTML. */
const unauthorized = () =>
  NextResponse.json({ error: 'Not signed in' }, { status: 401 })

const proxy = async (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => {
  const session = await auth()
  // `apiToken` is on the session server-side only — the /api/auth/session
  // endpoint strips it before the browser sees it. See app/api/auth/[...nextauth].
  const token = (session as { apiToken?: string } | null)?.apiToken
  if (!token) return unauthorized()

  const { path } = await ctx.params
  // Next has already decoded and normalised the segments, so this cannot be
  // reached by a `..` in the URL — but the guard is cheap and the failure it
  // prevents (a request escaping the API prefix on the upstream) is not.
  if (!path?.length || path.some((segment) => segment === '..' || segment.includes('/'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const headers = new Headers({ Authorization: `Bearer ${token}` })
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name)
    if (value) headers.set(name, value)
  }

  // Buffered rather than streamed: forwarding `req.body` needs `duplex: 'half'`,
  // which not every runtime this is deployed on implements. The only bodies that
  // come through here are JSON and a product picture, both already bounded by the
  // backend's own limits.
  const body =
    req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE'
      ? undefined
      : await req.arrayBuffer()

  let upstream: Response
  try {
    upstream = await fetch(`${API_URL}/${path.join('/')}${req.nextUrl.search}`, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
      // The upstream's 302 would be followed against the API host and the result
      // returned as if it were the answer. Nothing the backend serves redirects;
      // if that changes, it should reach the caller as a redirect.
      redirect: 'manual',
    })
  } catch {
    return NextResponse.json({ error: 'The server could not be reached.' }, { status: 502 })
  }

  const out = new Headers()
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) out.set(name, value)
  }
  // Everything behind this route is per-user data reached with a credential the
  // browser cannot see. A shared cache in front of this origin must not keep it.
  out.set('Cache-Control', 'no-store')

  return new NextResponse(upstream.body, { status: upstream.status, headers: out })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
