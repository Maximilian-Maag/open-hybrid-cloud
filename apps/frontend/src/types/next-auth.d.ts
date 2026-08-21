import type { Role } from '@open-hybrid-cloud/types'

declare module 'next-auth' {
  interface Session {
    apiToken?: string
    /** `exp` of the backend token, seconds since the epoch. See lib/session.ts. */
    apiTokenExp?: number
    user: {
      role?: Role
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}
