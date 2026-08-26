import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const authMock = vi.fn()
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }))

const apiRequestMock = vi.fn()
vi.mock('@/lib/api', () => ({ apiRequest: (...args: unknown[]) => apiRequestMock(...args) }))

const { get, post, put, del } = await import('./serverApi')

beforeEach(() => {
  authMock.mockReset()
  apiRequestMock.mockReset()
  authMock.mockResolvedValue({ apiToken: 'the-backend-jwt' })
  apiRequestMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('window', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Issue #146. One of the two modules in the frontend that read
 * `session.apiToken` — this one for server components, the `/api/proxy` route
 * for the browser — and deliberately not the one client components import. See
 * the file for why the split is load-bearing rather than tidy.
 */
describe('serverApi', () => {
  it.each([
    ['get', () => get('/api/orders'), { token: 'the-backend-jwt' }],
    ['post', () => post('/api/orders', { a: 1 }), { method: 'POST', body: { a: 1 }, token: 'the-backend-jwt' }],
    ['put', () => put('/api/orders/1', { a: 1 }), { method: 'PUT', body: { a: 1 }, token: 'the-backend-jwt' }],
    ['del', () => del('/api/orders/1'), { method: 'DELETE', token: 'the-backend-jwt' }],
  ])('%s attaches the session token', async (_name, call, expected) => {
    await call()
    expect(apiRequestMock.mock.calls[0][1]).toEqual(expected)
  })

  it('sends no token when nobody is signed in', async () => {
    // The public branding read on /impressum goes through here with no session,
    // and must still be made rather than refused.
    authMock.mockResolvedValue(null)

    await get('/api/public/branding')

    expect(apiRequestMock.mock.calls[0][1]).toEqual({ token: undefined })
  })

  it('refuses to run in a browser', async () => {
    // Importing this from a client component would drag `@/lib/auth`, and with
    // it the whole NextAuth server configuration, into the client bundle — the
    // thing the split exists to prevent. Failing loudly beats shipping it.
    vi.stubGlobal('window', {})

    await expect(get('/api/orders')).rejects.toThrow(/server-only/)
    expect(apiRequestMock).not.toHaveBeenCalled()
  })
})
