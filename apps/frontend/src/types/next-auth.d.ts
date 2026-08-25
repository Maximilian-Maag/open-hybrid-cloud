import type { Role } from '@open-hybrid-cloud/types'

declare module 'next-auth' {
  interface Session {
    /**
     * The backend JWT. SERVER-SIDE ONLY: `app/api/auth/[...nextauth]/route.ts`
     * strips it from the `/api/auth/session` response, so `auth()` sees it and
     * `useSession()` never does (issue #146). The only thing that reads it is
     * `lib/api.ts` on the server and the proxy route; nothing should put it in a
     * prop, a header a client sets, or anything else that reaches a browser.
     */
    apiToken?: string
    /** `exp` of the backend token, seconds since the epoch. See lib/session.ts. */
    apiTokenExp?: number
    /**
     * The signed-in administrator has no confirmed second factor and must enroll
     * one before the API will serve them anything else (issue #197).
     */
    mustEnrollSecondFactor?: boolean
    user: {
      role?: Role
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    /** Mirrors `Session.mustEnrollSecondFactor` (issue #197). */
    mustEnrollSecondFactor?: boolean
  }
}
