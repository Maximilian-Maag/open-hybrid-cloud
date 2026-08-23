import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST } from './route'

const makeReq = (body: unknown) =>
  new Request('http://localhost/api/login-challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const mockBackend = (body: unknown, status = 200) => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/login-challenge', () => {
  it('reports that a code is needed, and passes the challenge through', async () => {
    mockBackend({ mfaRequired: true, mfaToken: 'challenge', expiresIn: 300 })
    const body = await (await POST(makeReq({ email: 'root@x.dev', password: 'pw' }))).json()
    expect(body).toEqual({ ok: true, mfaRequired: true, mfaToken: 'challenge' })
  })

  it('says only "no code needed" on the no-second-factor path', async () => {
    mockBackend({ mfaRequired: false })
    const res = await POST(makeReq({ email: 'root@x.dev', password: 'pw' }))
    expect(await res.json()).toEqual({ ok: true, mfaRequired: false })
  })

  /**
   * Belt and braces. `challengeOnly` means the backend mints nothing to leak —
   * but if that ever regressed, this route still must not put a session token in
   * JavaScript's reach outside NextAuth, where it would have no cookie, no expiry
   * handling and no sign-out.
   */
  it('never returns a session token, even if the backend sends one', async () => {
    mockBackend({ token: 'a.real.session.token', user: { id: 1, email: 'root@x.dev', name: 'R', role: 'root' } })
    const res = await POST(makeReq({ email: 'root@x.dev', password: 'pw' }))
    const text = await res.text()

    expect(JSON.parse(text)).toEqual({ ok: true, mfaRequired: false })
    expect(text).not.toContain('a.real.session.token')
    expect(text).not.toContain('token')
  })

  it('passes a 401 through so the form can say the credentials were wrong', async () => {
    mockBackend({ error: 'Invalid credentials' }, 401)
    const res = await POST(makeReq({ email: 'root@x.dev', password: 'nope' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, error: 'Invalid credentials' })
  })

  it('passes a 429 through with the backend message, which says how long to wait', async () => {
    mockBackend({ error: 'Too many login attempts. Try again in 15 minutes.' }, 429)
    const res = await POST(makeReq({ email: 'root@x.dev', password: 'pw' }))
    expect(res.status).toBe(429)
    expect((await res.json()).error).toMatch(/15 minutes/)
  })

  it('rejects a request with no credentials without calling the backend', async () => {
    const fetchMock = mockBackend({})
    for (const body of [{}, { email: 'a@b.c' }, { password: 'pw' }, { email: 1, password: 2 }]) {
      const res = await POST(makeReq(body))
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports an unreachable backend rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const res = await POST(makeReq({ email: 'root@x.dev', password: 'pw' }))
    expect(res.status).toBe(502)
    expect((await res.json()).ok).toBe(false)
  })

  it('forwards the credentials to the backend login endpoint and nowhere else', async () => {
    const fetchMock = mockBackend({ mfaRequired: true, mfaToken: 'c', expiresIn: 300 })
    await POST(makeReq({ email: 'root@x.dev', password: 'pw' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/auth\/login$/)
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'root@x.dev',
      password: 'pw',
      rememberMe: false,
      challengeOnly: true,
    })
  })

  /**
   * The whole point of `challengeOnly`: this hop checks a password, and opening a
   * session here would leave a row in the user's own session list that no browser
   * holds (#37).
   */
  it('always asks with challengeOnly, so this hop can never open a session', async () => {
    for (const backendSays of [
      { mfaRequired: true, mfaToken: 'c', expiresIn: 300 },
      { mfaRequired: false },
    ]) {
      const fetchMock = mockBackend(backendSays)
      await POST(makeReq({ email: 'root@x.dev', password: 'pw' }))
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(JSON.parse(String(init.body)).challengeOnly).toBe(true)
    }
  })

  it('carries "remember me" to the password step, where it is sealed into the challenge', async () => {
    const fetchMock = mockBackend({ mfaRequired: true, mfaToken: 'c', expiresIn: 300 })
    await POST(makeReq({ email: 'root@x.dev', password: 'pw', rememberMe: true }))
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).rememberMe).toBe(true)
  })
})
