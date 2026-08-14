import { SignJWT, jwtVerify } from 'jose'
import type { SessionUser } from '@open-hybrid-cloud/types'

const ALG = 'HS256'

// Resolve the secret lazily on first use (request time) rather than at module
// load. A module-load throw would fire during `next build` page-data collection,
// where JWT_SECRET is not present — this still fails closed at runtime (an
// empty/short secret makes signing throw and verification return null, so no
// forged token is ever accepted) without breaking the build.
let cachedSecret: Uint8Array | null = null
const getSecret = (): Uint8Array => {
  if (cachedSecret) return cachedSecret
  const rawSecret = process.env.JWT_SECRET ?? ''
  if (rawSecret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long')
  }
  cachedSecret = new TextEncoder().encode(rawSecret)
  return cachedSecret
}

export const signToken = (user: SessionUser): Promise<string> =>
  new SignJWT({ user })
    .setProtectedHeader({ alg: ALG })
    .setExpirationTime('24h')
    .sign(getSecret())

export const verifyToken = async (token: string): Promise<SessionUser | null> => {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: [ALG] })
    return (payload as { user: SessionUser }).user
  } catch {
    return null
  }
}
