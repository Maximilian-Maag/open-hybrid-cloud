import { auth } from '@/lib/auth'
import { apiRequest } from '@/lib/api'

/**
 * The API, called from the server with the signed-in caller's token.
 *
 * Two modules rather than one, and the split is not cosmetic. `lib/api.ts` is in
 * the CLIENT bundle — every client component imports it — so anything it
 * imports goes to the browser too. Reading the session from there, even behind a
 * `typeof window` check and a dynamic `import()`, put the whole NextAuth server
 * configuration into the built client chunks; the strings `auth/login/mfa` and
 * `NEXTAUTH_SECRET` were in them. Nothing secret leaked (Next does not inline a
 * non-`NEXT_PUBLIC_` env value into a client bundle), but shipping the auth
 * config to the browser is not something to do on purpose.
 *
 * So: server components import `get` from here, client components import it from
 * `@/lib/api`, and this is the only module in the frontend that reads
 * `session.apiToken` for an API call (issue #146). The browser reaches the same
 * endpoints through `/api/proxy`, which attaches the token server-side.
 */
const bearer = async (): Promise<string | undefined> => {
  if (typeof window !== 'undefined') {
    // A guard, not an assertion about the code as it stands: importing this from
    // a client component would pull `@/lib/auth` into the browser bundle, which
    // is the thing the split exists to prevent. Failing loudly beats shipping it.
    throw new Error('lib/serverApi is server-only — client code must use lib/api')
  }
  const session = await auth()
  return (session as { apiToken?: string } | null)?.apiToken
}

export const get = async <T>(path: string) => apiRequest<T>(path, { token: await bearer() })

export const post = async <T>(path: string, body: unknown) =>
  apiRequest<T>(path, { method: 'POST', body, token: await bearer() })

export const put = async <T>(path: string, body: unknown) =>
  apiRequest<T>(path, { method: 'PUT', body, token: await bearer() })

export const del = async <T>(path: string) =>
  apiRequest<T>(path, { method: 'DELETE', token: await bearer() })
