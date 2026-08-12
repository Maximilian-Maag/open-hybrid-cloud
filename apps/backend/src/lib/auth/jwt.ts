import { SignJWT, jwtVerify } from 'jose'
import type { SessionUser } from '@open-hybrid-cloud/types'

const rawSecret = process.env.JWT_SECRET ?? ''
if (rawSecret.length < 32) {
  // Fail fast: an empty/short secret means tokens are signed with a trivially
  // guessable key, letting anyone forge a root session. Never boot in that state.
  throw new Error(
    'JWT_SECRET must be set and at least 32 characters long',
  )
}
const secret = new TextEncoder().encode(rawSecret)
const ALG = 'HS256'

export const signToken = (user: SessionUser): Promise<string> =>
  new SignJWT({ user })
    .setProtectedHeader({ alg: ALG })
    .setExpirationTime('24h')
    .sign(secret)

export const verifyToken = async (token: string): Promise<SessionUser | null> => {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] })
    return (payload as { user: SessionUser }).user
  } catch {
    return null
  }
}
