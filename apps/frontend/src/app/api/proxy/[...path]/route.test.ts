import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const authMock = vi.fn()
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }))

const { GET, POST, DELETE } = await import('./route')

const params = (...path: string[]) => ({ params: Promise.resolve({ path }) })

const req = (url: string, init?: RequestInit) => new NextRequest(new Request(url, init))

const upstream = (body: unknown, init: ResponseInit = {}) => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  authMock.mockReset()
  authMock.mockResolvedValue({ apiToken: 'the-backend-jwt' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Issue #146. This route is the only thing between a browser and the backend
 * API, so the tests are about what it does with the credential, not about
 * plumbing: the token must be added here and only here, and nothing the caller
 * sends may influence where the request goes or what identity it carries.
 */
describe('the API proxy', () => {
  it('attaches the session token the browser never sees', async () => {
    const fetchMock = upstream({ ok: true })

    await GET(req('http://localhost/api/proxy/api/orders'), params('api', 'orders'))

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/orders')
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer the-backend-jwt')
  })

  it('answers 401 rather than forwarding when there is no session', async () => {
    authMock.mockResolvedValue(null)
    const fetchMock = upstream({ ok: true })

    const res = await GET(req('http://localhost/api/proxy/api/orders'), params('api', 'orders'))

    expect(res.status).toBe(401)
    // A 401 the caller can act on — lib/api.ts turns it into a sign-out. The
    // middleware deliberately does not claim this path, so it must not be a
    // redirect to the login page, which `fetch` would follow and parse as JSON.
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores an Authorization header the caller supplied', async () => {
    // Otherwise the proxy is a way to replay somebody else's token through this
    // origin's server, with this origin's egress.
    const fetchMock = upstream({ ok: true })

    await GET(
      req('http://localhost/api/proxy/api/orders', { headers: { Authorization: 'Bearer stolen' } }),
      params('api', 'orders'),
    )

    expect((fetchMock.mock.calls[0][1].headers as Headers).get('Authorization')).toBe('Bearer the-backend-jwt')
  })

  it('does not forward the session cookie to the backend', async () => {
    const fetchMock = upstream({ ok: true })

    await GET(
      req('http://localhost/api/proxy/api/orders', { headers: { cookie: 'authjs.session-token=secret' } }),
      params('api', 'orders'),
    )

    expect((fetchMock.mock.calls[0][1].headers as Headers).get('cookie')).toBeNull()
  })

  it('carries the query string, the method and the body through', async () => {
    const fetchMock = upstream({ id: 1 })

    await POST(
      req('http://localhost/api/proxy/api/orders?projectId=4', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId: 9 }),
      }),
      params('api', 'orders'),
    )

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/orders?projectId=4')
    expect(init.method).toBe('POST')
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(JSON.stringify({ productId: 9 }))
  })

  it('returns the backend status and Content-Disposition, so an export downloads', async () => {
    // The cost, audit and infrastructure exports are fetched as blobs precisely
    // so nothing identifying lands in a URL; the filename comes back in this
    // header, and dropping it turns every export into "download".
    upstream('id,cost\n', {
      status: 200,
      headers: {
        'content-type': 'text/csv',
        'content-disposition': 'attachment; filename="costs.csv"',
      },
    })

    const res = await GET(req('http://localhost/api/proxy/api/costs/export'), params('api', 'costs', 'export'))

    expect(res.headers.get('content-disposition')).toBe('attachment; filename="costs.csv"')
    expect(res.headers.get('content-type')).toBe('text/csv')
  })

  it('passes a backend error status through instead of flattening it', async () => {
    upstream({ error: 'Forbidden' }, { status: 403 })

    const res = await GET(req('http://localhost/api/proxy/api/admin/users'), params('api', 'admin', 'users'))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
  })

  it('answers 502 when the backend cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const res = await GET(req('http://localhost/api/proxy/api/orders'), params('api', 'orders'))

    expect(res.status).toBe(502)
  })

  it('refuses a path that tries to climb out of the API prefix', async () => {
    const fetchMock = upstream({ ok: true })

    const res = await DELETE(req('http://localhost/api/proxy/api/../admin'), params('api', '..', 'admin'))

    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks every answer no-store, because all of it is one user’s data', async () => {
    upstream({ ok: true }, { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=3600' } })

    const res = await GET(req('http://localhost/api/proxy/api/orders'), params('api', 'orders'))

    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
