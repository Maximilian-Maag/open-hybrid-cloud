/**
 * Fields that live on the session for the server's benefit and must not reach the
 * browser (issue #146).
 *
 * `apiToken` is the backend JWT: a bearer credential with 24 hours of full API
 * access as the signed-in user, valid from anywhere, which is why handing it to
 * client JavaScript turns any XSS on this origin into an account takeover that
 * outlives the page. The browser reaches the API through `/api/proxy` instead,
 * authenticated by the HttpOnly session cookie.
 *
 * `apiTokenExp` deliberately stays: it is a number, it tells the browser nothing
 * it could not learn by making a request that 401s, and `lib/session.ts` uses it
 * to end a session before making one.
 */
const SERVER_ONLY_FIELDS = ['apiToken'] as const

/**
 * A copy of a NextAuth session response with the server-only fields removed.
 *
 * Written defensively because it sits on the sign-in path: anything other than a
 * JSON object body — an error, a redirect, an empty 200 for a signed-out caller
 * — is passed straight through untouched rather than being rebuilt, so a failure
 * to parse can never turn a working auth endpoint into a broken one. The only
 * case that is rewritten is the one that actually carries a session.
 */
export const stripServerOnlySessionFields = async (res: Response): Promise<Response> => {
  if (!res.headers.get('content-type')?.includes('application/json')) return res

  const text = await res.clone().text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return res
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return res

  const body = parsed as Record<string, unknown>
  if (!SERVER_ONLY_FIELDS.some((field) => field in body)) return res

  for (const field of SERVER_ONLY_FIELDS) delete body[field]

  // The headers are carried over — NextAuth sets Set-Cookie on some of these
  // responses, and dropping it would silently stop the session from rotating.
  // Content-Length is not, because the body just got shorter.
  const headers = new Headers(res.headers)
  headers.delete('content-length')
  return new Response(JSON.stringify(body), { status: res.status, statusText: res.statusText, headers })
}
