import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import type { LoginRequest, LoginResponse, Role } from '@open-hybrid-cloud/types'
import { SESSION_COOKIE_MAX_AGE_SECONDS, apiTokenExpiry } from '@/lib/session'

const API_URL = process.env.API_URL ?? 'http://localhost:3001'

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { type: 'email' },
        password: { type: 'password' },
        // Arrives as the string 'true' from signIn(), because credentials are
        // form fields. Anything else means no.
        rememberMe: { type: 'text' },
      },
      async authorize(credentials) {
        const res = await fetch(`${API_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: String(credentials.email ?? ''),
            password: String(credentials.password ?? ''),
            rememberMe: String(credentials.rememberMe ?? '') === 'true',
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
  // Sized to the LONGEST session the backend will issue, not to a fixed one.
  //
  // #103's bug was a 30-day cookie wrapped around a 24 h token: "signed in" with
  // nothing behind it. #37 makes the lifetime per-session (8 h, or 30 days with
  // "remember me"), so a single number can no longer be the lifetime — it can
  // only be the ceiling. What actually ends a session is the token's own `exp`,
  // carried as `apiTokenExp` and checked by the middleware and the dashboard
  // layout on every request, plus the 401 handling in lib/api.ts for a session
  // that ends early because it was revoked. See lib/session.ts.
  session: { maxAge: SESSION_COOKIE_MAX_AGE_SECONDS },
  pages: { signIn: '/login' },
  secret: process.env.NEXTAUTH_SECRET,
})

