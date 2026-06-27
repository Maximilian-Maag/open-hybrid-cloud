import { SignJWT, jwtVerify } from 'jose'
import type { SessionUser } from '@open-hybrid-cloud/types'

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? '')
const ALG = 'HS256'

export const signToken = (user: SessionUser): Promise<string> =>
  new SignJWT({ user })
    .setProtectedHeader({ alg: ALG })
    .setExpirationTime('24h')
    .sign(secret)

export const verifyToken = async (token: string): Promise<SessionUser | null> => {
  try {
    const { payload } = await jwtVerify(token, secret)
    return (payload as { user: SessionUser }).user
  } catch {
    return null
  }
}
