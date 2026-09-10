import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT, DELETE } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'
import { createIntegration } from '@/lib/services/admin/integrations'

const makeReq = (id: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/integrations/${id}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const rootAuth = () => createUser({ role: 'root' }).then(makeAuthHeader)

const seed = async () => {
  const root = await createUser({ role: 'root' })
  const created = await createIntegration(root.id, {
    kind: 'foreman',
    name: 'Foreman Prod',
    baseUrl: 'https://foreman.example.com',
    authType: 'bearer',
    credential: 'glpat-super-secret',
    failureMode: 'blocking',
  })
  if (!created.ok) throw new Error('setup failed')
  return { auth: await makeAuthHeader(root), id: created.data.id }
}

describe('GET /api/admin/integrations/[id]', () => {
  it('returns 401 without an auth token', async () => {
    expect((await GET(makeReq('1'), params('1'))).status).toBe(401)
  })

  it('returns 403 for admin', async () => {
    const auth = await makeAuthHeader(await createUser({ role: 'admin' }))
    expect((await GET(makeReq('1', 'GET', undefined, auth), params('1'))).status).toBe(403)
  })

  it('returns the integration for root, without the credential', async () => {
    const { auth, id } = await seed()
    const res = await GET(makeReq(String(id), 'GET', undefined, auth), params(String(id)))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('glpat-super-secret')
    expect(JSON.parse(text)).toMatchObject({ id, hasCredential: true })
  })

  it('returns 404 for an id that does not exist', async () => {
    const auth = await rootAuth()
    expect((await GET(makeReq('999999', 'GET', undefined, auth), params('999999'))).status).toBe(404)
  })

  it('returns 400 for an id that is not a number', async () => {
    // parseInt would read `1abc` as 1 and act on a record nobody asked for.
    const auth = await rootAuth()
    for (const bad of ['1abc', '1.5', 'abc', '-1', '0']) {
      const res = await GET(makeReq(bad, 'GET', undefined, auth), params(bad))
      expect(res.status).toBe(400)
    }
  })
})

describe('PUT /api/admin/integrations/[id]', () => {
  it('returns 401 without an auth token', async () => {
    expect((await PUT(makeReq('1', 'PUT', { enabled: false }), params('1'))).status).toBe(401)
  })

  it('returns 403 for admin', async () => {
    const auth = await makeAuthHeader(await createUser({ role: 'admin' }))
    const res = await PUT(makeReq('1', 'PUT', { enabled: false }, auth), params('1'))
    expect(res.status).toBe(403)
  })

  it('updates for root', async () => {
    const { auth, id } = await seed()
    const res = await PUT(
      makeReq(String(id), 'PUT', { name: 'Foreman Staging', enabled: false }, auth),
      params(String(id)),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ name: 'Foreman Staging', enabled: false })
  })

  it('refuses to change the kind', async () => {
    // Zod strips unknown keys rather than erroring, so the assertion is that the
    // kind is UNCHANGED: a Foreman must not end up as a Nexus carrying the
    // Foreman's credential, health record and audit history.
    const { auth, id } = await seed()
    const res = await PUT(makeReq(String(id), 'PUT', { kind: 'nexus' }, auth), params(String(id)))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ kind: 'foreman' })
  })

  it('returns 400 for an invalid failure mode', async () => {
    const { auth, id } = await seed()
    const res = await PUT(
      makeReq(String(id), 'PUT', { failureMode: 'sometimes' }, auth),
      params(String(id)),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for a bad id', async () => {
    const auth = await rootAuth()
    expect((await PUT(makeReq('x', 'PUT', { enabled: false }, auth), params('x'))).status).toBe(400)
  })

  it('returns 404 for an id that does not exist', async () => {
    const auth = await rootAuth()
    const res = await PUT(makeReq('999999', 'PUT', { enabled: false }, auth), params('999999'))
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/admin/integrations/[id]', () => {
  it('returns 401 without an auth token', async () => {
    expect((await DELETE(makeReq('1', 'DELETE'), params('1'))).status).toBe(401)
  })

  it('returns 403 for admin', async () => {
    const auth = await makeAuthHeader(await createUser({ role: 'admin' }))
    expect((await DELETE(makeReq('1', 'DELETE', undefined, auth), params('1'))).status).toBe(403)
  })

  it('deletes for root', async () => {
    const { auth, id } = await seed()
    const res = await DELETE(makeReq(String(id), 'DELETE', undefined, auth), params(String(id)))
    expect(res.status).toBe(200)

    const after = await GET(makeReq(String(id), 'GET', undefined, auth), params(String(id)))
    expect(after.status).toBe(404)
  })

  it('returns 400 for a bad id and 404 for an unknown one', async () => {
    const auth = await rootAuth()
    expect((await DELETE(makeReq('x', 'DELETE', undefined, auth), params('x'))).status).toBe(400)
    const unknown = await DELETE(makeReq('999999', 'DELETE', undefined, auth), params('999999'))
    expect(unknown.status).toBe(404)
  })
})
