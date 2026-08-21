import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { isApiTokenExpired } from '@/lib/session'

export default auth((req) => {
  // Two reasons to send someone to the login page, and they read differently to
  // the person: never signed in, versus signed in and the session ran out. The
  // second used to have no handling at all — the page rendered, every API call
  // came back 401, and the user was left on a shell with no data and no
  // explanation (#103).
  const expired = isApiTokenExpired(req.auth?.apiTokenExp)

  if (!req.auth || expired) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname)
    if (expired) loginUrl.searchParams.set('expired', '1')
    return NextResponse.redirect(loginUrl)
  }
})

export const config = {
  matcher: [
    /*
     * Protect all routes except:
     *   - /login and /impressum (public pages)
     *   - /api/auth/* (NextAuth internal endpoints)
     *   - Next.js static files and images
     */
    '/((?!login|impressum|api/auth|api/ping|_next/static|_next/image|favicon\\.ico).*)',
  ],
}
