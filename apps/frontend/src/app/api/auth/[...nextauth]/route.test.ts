import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The NextAuth endpoints, and the one thing this route exists to take out of
 * them: `session.apiToken`, the backend bearer JWT (#146).
 *
 * The stripping itself is tested in `lib/sessionResponse.test.ts`. What is tested
 * here is that BOTH verbs are wrapped in it — the first cut of this route wrapped
 * only GET, and `useSession().update()` POSTs to `/api/auth/session` and gets the
 * same session JSON back. So the leak was closed on page load and left open on
 * every session refresh, which is exactly what the two 2FA cards trigger after
 * enrolling.
 */

const sessionBody = {
  user: { id: 1, email: 'root@test.dev', name: 'Root', role: 'root' },
  apiToken: 'eyJhbGciOi.THE-BACKEND-JWT.signature',
  apiTokenExp: 1893456000,
  expires: '2099-01-01T00:00:00.000Z',
}

const jsonResponse = () =>
  new Response(JSON.stringify(sessionBody), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

// vi.hoisted: `vi.mock` is lifted above every const in the file, so a factory
// closing over a plain `const` spy reads it before it exists.
const { handlerGET, handlerPOST } = vi.hoisted(() => ({
  handlerGET: vi.fn(),
  handlerPOST: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ handlers: { GET: handlerGET, POST: handlerPOST } }))

import { GET, POST } from './route'

const request = () => new Request('http://localhost:3000/api/auth/session') as never

beforeEach(() => {
  handlerGET.mockReset().mockImplementation(async () => jsonResponse())
  handlerPOST.mockReset().mockImplementation(async () => jsonResponse())
})

describe('/api/auth/[...nextauth]', () => {
  it('keeps the backend token out of the GET response', async () => {
    const body = await (await GET(request())).json()

    expect(body.apiToken).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('THE-BACKEND-JWT')
  })

  // The regression. `update()` is a POST, and it returns the session.
  it('keeps the backend token out of the POST response', async () => {
    const body = await (await POST(request())).json()

    expect(body.apiToken).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('THE-BACKEND-JWT')
  })

  it.each([['GET', GET], ['POST', POST]] as const)(
    'leaves the rest of the session intact on %s',
    async (_verb, handler) => {
      const body = await (await handler(request())).json()

      expect(body.user).toEqual(sessionBody.user)
      expect(body.expires).toBe(sessionBody.expires)
      // A number the browser could learn from a 401 anyway, and lib/session.ts
      // uses it to end a session before making a doomed request.
      expect(body.apiTokenExp).toBe(sessionBody.apiTokenExp)
    },
  )

  it.each([['GET', GET, handlerGET], ['POST', POST, handlerPOST]] as const)(
    'still delegates %s to NextAuth',
    async (_verb, handler, spy) => {
      await handler(request())
      expect(spy).toHaveBeenCalledOnce()
    },
  )
})
