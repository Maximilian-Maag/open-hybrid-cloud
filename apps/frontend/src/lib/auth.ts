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
    jwt({ token, user }) {
      if (user) {
        const u = user as { role: Role; apiToken: string }
        token['role'] = u.role
        token['apiToken'] = u.apiToken
      }
      return token
    },
    session({ session, token }) {
      session.apiToken = token['apiToken'] as string | undefined
      if (session.user) {
        session.user.role = token['role'] as Role | undefined
      }
      return session
    },
  },
  pages: { signIn: '/login' },
  secret: process.env.NEXTAUTH_SECRET,
})
