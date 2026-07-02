import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import type { LoginRequest, LoginResponse, Role } from '@open-hybrid-cloud/types'

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
        token.role = (user as any).role
        token.apiToken = (user as any).apiToken
      }
      return token
    },

    // The 'session' callback is called next.
    // It uses the data from the JWT token to build the final session object passed to the client.
    session({ session, token }) {
      // THIS IS THE CRITICAL FIX:
      // Ensure the user object exists on the session before modifying it.
      if (session.user) {
        // Add the 'role' to the user object.
        ;(session.user as any).role = token.role as Role | undefined
      }
      // Add the 'apiToken' to the top level of the session object.
      session.apiToken = token.apiToken as string | undefined
      return session
    },
  },
  pages: { signIn: '/login' },
  secret: process.env.NEXTAUTH_SECRET,
})

