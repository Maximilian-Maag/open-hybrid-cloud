import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  if (!req.auth) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname)
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
    '/((?!login|impressum|api/auth|_next/static|_next/image|favicon\\.ico).*)',
  ],
}
