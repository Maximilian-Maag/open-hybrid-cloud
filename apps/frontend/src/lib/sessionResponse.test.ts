import { describe, it, expect } from 'vitest'
import { stripServerOnlySessionFields } from './sessionResponse'

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })

/**
 * Issue #146. `/api/auth/session` is what `useSession()` fetches, so anything on
 * it is readable by any script on this origin — including one injected by an
 * XSS. `apiToken` is a bearer credential with a day of full API access, so it
 * has to come off on the way out while `auth()` on the server still sees it.
 */
describe('stripServerOnlySessionFields', () => {
  it('removes apiToken from a session response', async () => {
    const res = await stripServerOnlySessionFields(
      json({ user: { email: 'root@x.dev' }, apiToken: 'a.real.jwt', apiTokenExp: 1800000000 }),
    )

    const body = await res.json()
    expect(body).not.toHaveProperty('apiToken')
    expect(JSON.stringify(body)).not.toContain('a.real.jwt')
  })

  it('keeps everything else, including the expiry the browser needs', async () => {
    // apiTokenExp is not a credential — it is when the token dies, which the
    // browser could learn by making a request that 401s. lib/session.ts uses it
    // to end the session before making one.
    const res = await stripServerOnlySessionFields(
      json({ user: { email: 'root@x.dev', role: 'admin' }, apiToken: 'jwt', apiTokenExp: 1800000000, expires: 'x' }),
    )

    expect(await res.json()).toEqual({
      user: { email: 'root@x.dev', role: 'admin' },
      apiTokenExp: 1800000000,
      expires: 'x',
    })
  })

  it('carries Set-Cookie over, so the session still rotates', async () => {
    // Rebuilding the response is what makes this a risk: NextAuth sets cookies
    // on some of these, and losing one would silently break the session rather
    // than fail loudly.
    const res = await stripServerOnlySessionFields(
      json({ apiToken: 'jwt' }, { headers: { 'content-type': 'application/json', 'set-cookie': 'authjs.x=1' } }),
    )

    expect(res.headers.get('set-cookie')).toBe('authjs.x=1')
  })

  it('leaves a response with no session untouched', async () => {
    // A signed-out caller gets `null` from this endpoint. Rebuilding it would be
    // pointless and is one more thing to get wrong.
    const original = json(null)
    expect(await stripServerOnlySessionFields(original)).toBe(original)
  })

  it('leaves a non-JSON response untouched', async () => {
    // Redirects and HTML errors go through this same handler on the sign-in
    // path; touching them is how a working auth endpoint becomes a broken one.
    const original = new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
    expect(await stripServerOnlySessionFields(original)).toBe(original)
  })

  it('leaves a malformed JSON body untouched rather than throwing', async () => {
    const original = new Response('{not json', { headers: { 'content-type': 'application/json' } })
    expect(await stripServerOnlySessionFields(original)).toBe(original)
  })

  it('does not rebuild a response that has nothing to strip', async () => {
    const original = json({ user: { email: 'root@x.dev' } })
    expect(await stripServerOnlySessionFields(original)).toBe(original)
  })
})
