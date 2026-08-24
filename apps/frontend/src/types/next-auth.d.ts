import type { Role } from '@open-hybrid-cloud/types'

declare module 'next-auth' {
  interface Session {
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
