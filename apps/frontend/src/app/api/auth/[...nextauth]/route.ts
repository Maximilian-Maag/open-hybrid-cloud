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
export const POST = handlers.POST

export const GET = async (req: NextRequest): Promise<Response> =>
  stripServerOnlySessionFields(await handlers.GET(req))
