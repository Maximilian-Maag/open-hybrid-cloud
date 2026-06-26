import type { Role } from '@open-hybrid-cloud/types'

declare module 'next-auth' {
  interface Session {
    apiToken?: string
    user: {
      role?: Role
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}
