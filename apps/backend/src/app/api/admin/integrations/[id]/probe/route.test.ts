import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'
import { createIntegration } from '@/lib/services/admin/integrations'

afterEach(() => vi.restoreAllMocks())

const makeReq = (id: string, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/integrations/${id}/probe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  })

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const seed = async (overrides?: { enabled?: boolean }) => {
  const root = await createUser({ role: 'root' })
  const created = await createIntegration(root.id, {
    kind: 'foreman',
    name: 'Foreman Prod',
    baseUrl: 'https://foreman.example.com',
    authType: 'bearer',
    credential: 'glpat-super-secret',
    failureMode: 'blocking',
    ...overrides,
  })
  if (!created.ok) throw new Error('setup failed')
  return { auth: await makeAuthHeader(root), id: created.data.id }
}

describe('POST /api/admin/integrations/[id]/probe', () => {
  it('returns 401 without an auth token', async () => {
    expect((await POST(makeReq('1'), params('1'))).status).toBe(401)
  })

  it('returns 403 for a project manager and for an admin', async () => {
    for (const role of ['project_manager', 'admin'] as const) {
      const auth = await makeAuthHeader(await createUser({ role }))
      expect((await POST(makeReq('1', auth), params('1'))).status).toBe(403)
    }
  })

  it('does not contact anything when the caller is not root', async () => {
    // The auth gate has to come before the outbound call, or an unauthorised
    // caller can still make the portal hit a URL of their choosing.
    const fetchMock = vi.spyOn(global, 'fetch')
    const { id } = await seed()
    await POST(makeReq(String(id)), params(String(id)))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a reachable integration', async () => {
    const { auth, id } = await seed()
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: '3.9.1', api_version: 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await POST(makeReq(String(id), auth), params(String(id)))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      status: 200,
      detail: 'Foreman 3.9.1, API v2',
    })
  })

  it('reports an unreachable integration as a 200 with ok: false', async () => {
    // The admin asked whether it works; "no, because …" answers that question.
    // A 502 here would be indistinguishable from the portal itself failing.
    const { auth, id } = await seed()
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('getaddrinfo ENOTFOUND foreman'))

    const res = await POST(makeReq(String(id), auth), params(String(id)))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain('ENOTFOUND')
    expect(body.lastError).toContain('ENOTFOUND')
    expect(body.lastContactedAt).toBeNull()
  })

  it('returns 409 for a disabled integration', async () => {
    const { auth, id } = await seed({ enabled: false })
    const res = await POST(makeReq(String(id), auth), params(String(id)))
    expect(res.status).toBe(409)
  })

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    const auth = await makeAuthHeader(await createUser({ role: 'root' }))
    expect((await POST(makeReq('999999', auth), params('999999'))).status).toBe(404)
    expect((await POST(makeReq('1abc', auth), params('1abc'))).status).toBe(400)
  })
})
