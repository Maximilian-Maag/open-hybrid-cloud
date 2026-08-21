import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import type { LoginRequest, LoginResponse, Role } from '@open-hybrid-cloud/types'
import { API_TOKEN_MAX_AGE_SECONDS, apiTokenExpiry } from '@/lib/session'

const API_URL = process.env.API_URL ?? 'http://localhost:3001'

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { type: 'email' },
        password: { type: 'password' },
      },
      async authorize(credentials) {
        const res = await fetch(`${API_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: String(credentials.email ?? ''),
            password: String(credentials.password ?? ''),
          } satisfies LoginRequest),
        })

        if (!res.ok) return null
        const data: LoginResponse = await res.json()

        // IMPORTANT: The 'user' object returned here is what populates the 'user' parameter in the 'jwt' callback
        return {
          id: String(data.user.id),
          email: data.user.email,
          name: data.user.name,
          role: data.user.role,
          apiToken: data.token,
        }
      },
    }),
  ],
  callbacks: {
    // The 'jwt' callback is called first.
    // The 'user' object is only passed on the first call after sign-in.
    jwt({ token, user }) {
      if (user) {
        // Persist the user role and apiToken from the 'authorize' function into the JWT token.
        const u = user as { role: Role; apiToken: string }
        token.role = u.role
        token.apiToken = u.apiToken
        // Carried so the middleware can end the session before making a request
        // that is certain to come back 401 (#103).
        token.apiTokenExp = apiTokenExpiry(u.apiToken)
      }
      return token
    },

    // The 'session' callback is called next.
    // It uses the data from the JWT token to build the final session object passed to the client.
    session({ session, token }) {
      // Ensure the user object exists on the session before modifying it.
      if (session.user) {
        session.user.role = token.role as Role | undefined
      }
      session.apiToken = token.apiToken as string | undefined
      session.apiTokenExp = (token.apiTokenExp as number | null | undefined) ?? undefined
      return session
    },
  },
  // Both clocks, one lifetime. NextAuth defaults to 30 days while the backend
  // signs its token for 24 h, and that gap was the bug in #103: a cookie that
  // still says "signed in" wrapped around a token nothing accepts any more.
  session: { maxAge: API_TOKEN_MAX_AGE_SECONDS },
  pages: { signIn: '/login' },
  secret: process.env.NEXTAUTH_SECRET,
})

