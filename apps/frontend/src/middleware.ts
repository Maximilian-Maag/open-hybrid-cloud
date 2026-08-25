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

  // An administrator who owes a second factor goes to the one page where they can
  // set one up (issue #197). This is a convenience, not the control: the backend
  // refuses every route except the enrollment endpoints for such a session, so
  // skipping this redirect gains nothing but a 403.
  //
  // /settings is excluded or the redirect would loop, and /api is excluded
  // because these are the frontend's own routes — sending a `fetch` to an HTML
  // page is how #36 turned every sign-in into "invalid credentials".
  if (
    req.auth.mustEnrollSecondFactor &&
    !req.nextUrl.pathname.startsWith('/settings') &&
    !req.nextUrl.pathname.startsWith('/api')
  ) {
    const setup = new URL('/settings', req.url)
    setup.searchParams.set('enroll2fa', '1')
    return NextResponse.redirect(setup)
  }
})

export const config = {
  matcher: [
    /*
     * Protect all routes except:
     *   - /login and /impressum (public pages)
     *   - /api/auth/* (NextAuth internal endpoints)
     *   - /api/login-challenge (step one of signing in — see below)
     *   - Next.js static files and images
     *
     * /api/login-challenge is reached by someone who is BY DEFINITION not signed
     * in yet, so leaving it in the protected set made the middleware 307 the
     * form's POST to /login. `fetch` followed that redirect, the form got the
     * login page instead of JSON, and every sign-in — second factor or not —
     * died as "Invalid email or password" without ever reaching the backend
     * (#36). Anything added under /api here needs the same thought: an endpoint
     * that is part of signing in cannot require being signed in.
     */
    '/((?!login|impressum|api/auth|api/login-challenge|api/ping|_next/static|_next/image|favicon\\.ico).*)',
  ],
}
