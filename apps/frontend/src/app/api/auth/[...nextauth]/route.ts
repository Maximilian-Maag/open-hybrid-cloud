import type { NextRequest } from 'next/server'
import { handlers } from '@/lib/auth'
import { stripServerOnlySessionFields } from '@/lib/sessionResponse'

/**
 * NextAuth's own endpoints, with one thing taken out of the session response.
 *
 * `session.apiToken` is the backend JWT. Server components need it — it is how
 * they call the API — but `/api/auth/session` is what `useSession()` fetches, so
 * leaving it in the response handed the raw bearer token to any script running on
 * this origin (issue #146). Stripping it here rather than in the `session`
 * callback is what lets both be true at once: `auth()` on the server still sees
 * the token, and the browser never does.
 *
 * This is the ONLY route that serialises a session to the browser — the root
 * layout mounts `<SessionProvider>` with no `session` prop, so the client's copy
 * always comes from here. If that ever changes, the prop is a second copy of
 * this leak and has to be stripped too.
 */
/**
 * Both verbs, not just GET.
 *
 * `useSession().update()` — which TwoFactorCard and SecurityKeysCard both call
 * after enrolling — POSTs to `/api/auth/session`, and NextAuth answers it with
 * the same session JSON that GET returns. Stripping only GET therefore closed
 * the leak on page load and left it open on every session refresh, which is
 * precisely the moment the 2FA cards trigger one. Caught in review of this PR.
 *
 * The wrapper is a no-op on every other NextAuth endpoint that goes through
 * here: it rewrites a response only when the body is a JSON object that
 * actually carries one of the server-only fields, and passes redirects, errors
 * and the CSRF and provider endpoints through untouched.
 */
export const POST = async (req: NextRequest): Promise<Response> =>
  stripServerOnlySessionFields(await handlers.POST(req))

export const GET = async (req: NextRequest): Promise<Response> =>
  stripServerOnlySessionFields(await handlers.GET(req))
