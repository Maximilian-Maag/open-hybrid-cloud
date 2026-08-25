import type { Role } from '@open-hybrid-cloud/types'

declare module 'next-auth' {
  interface Session {
    /**
     * The backend JWT. SERVER-SIDE ONLY: `app/api/auth/[...nextauth]/route.ts`
     * strips it from the `/api/auth/session` response on GET and on POST, so
     * `auth()` sees it and `useSession()` never does (issue #146).
     *
     * Two modules read it, and only two: `lib/serverApi.ts`, for server
     * components, and the `/api/proxy` route that stands in for it on the
     * browser's behalf. Both run server-side. `lib/api.ts` does NOT read it —
     * that module is in the client bundle, which is the whole reason the split
     * exists. Nothing should put this in a prop, a header a client sets, or
     * anything else that reaches a browser.
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
