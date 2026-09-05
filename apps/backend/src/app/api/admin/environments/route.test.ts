import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { createUser, createCiSource, makeAuthHeader } from '@/test/helpers'

const makeReq = (url: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('GET /api/admin/environments', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/admin/environments'))
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq('http://localhost/api/admin/environments', 'GET', undefined, auth))
    expect(res.status).toBe(403)
  })

  it('returns environments list for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/admin/environments', 'GET', undefined, auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('root can also list environments', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await GET(makeReq('http://localhost/api/admin/environments', 'GET', undefined, auth))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/admin/environments', () => {
  it('returns 401 without auth token', async () => {
    const res = await POST(
      makeReq('http://localhost/api/admin/environments', 'POST', {
        name: 'Env',
        ciSourceId: 1,
        webhookUrl: 'https://example.com',
        webhookToken: 'token',
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const ci = await createCiSource()
    const auth = await makeAuthHeader(pm)
    const res = await POST(
      makeReq(
        'http://localhost/api/admin/environments',
        'POST',
        {
          name: 'Env',
          ciSourceId: ci.id,
          webhookUrl: 'https://example.com/hook',
          webhookToken: 'token',
        },
        auth,
      ),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid webhookUrl', async () => {
    const admin = await createUser({ role: 'admin' })
    const ci = await createCiSource()
    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq(
        'http://localhost/api/admin/environments',
        'POST',
        {
          name: 'Env',
          ciSourceId: ci.id,
          webhookUrl: 'not-a-url',
          webhookToken: 'token',
        },
        auth,
      ),
    )
    expect(res.status).toBe(400)
  })

  it('creates environment for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const ci = await createCiSource()
    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq(
        'http://localhost/api/admin/environments',
        'POST',
        {
          name: 'Production',
          ciSourceId: ci.id,
          webhookUrl: 'https://gitlab.example.com/trigger',
          webhookToken: 'my-secret-token',
        },
        auth,
      ),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe('Production')
    expect(body.ciSourceId).toBe(ci.id)
    expect(body.id).toBeDefined()
  })
})

// Issue #144. webhook_token is the OUTBOUND trigger token: whoever holds it can
// fire arbitrary pipelines in the CI project. It used to come back in cleartext
// from every one of these paths at admin level, while the inbound callback_secret
// was correctly root-gated behind its own reveal endpoint — the more dangerous of
// the two, at the lower role.
describe('the outbound webhook token never comes back', () => {
  // `name` is passed separately and must never contain the token: naming the row
  // after its own secret makes `not.toContain(token)` trip over the name instead
  // of over a leak, which is a test that fails for the wrong reason.
  const create = async (auth: string, name: string, token: string, ciSourceId: number) =>
    POST(
      makeReq('http://localhost/api/admin/environments', 'POST', {
        name,
        ciSourceId,
        webhookUrl: 'https://gitlab.example.com/api/v4/projects/1/trigger/pipeline',
        webhookToken: token,
      }, auth),
    )

  it('not from POST, not from GET', async () => {
    const admin = await createUser({ role: 'admin' })
    const ci = await createCiSource()
    const auth = await makeAuthHeader(admin)
    const token = `glptt-outbound-${Math.random().toString(36).slice(2)}`
    const name = `Env probe-${Math.random().toString(36).slice(2)}`

    const created = await create(auth, name, token, ci.id)
    expect(created.status).toBe(201)
    expect(await created.text()).not.toContain(token)

    const listed = await GET(makeReq('http://localhost/api/admin/environments', 'GET', undefined, auth))
    expect(listed.status).toBe(200)
    const text = await listed.text()
    expect(text).not.toContain(token)

    // The admin UI needs to know a token is configured — it just never needs the
    // value, and PUT /:id still replaces it.
    const row = JSON.parse(text).find((e: { name: string }) => e.name === name)
    expect(row).toMatchObject({ webhookTokenSet: true })
    expect(row).not.toHaveProperty('webhookToken')
    // Nor the inbound secret, which was already gated. Asserted here too so the
    // two cannot drift apart again.
    expect(row).not.toHaveProperty('callbackSecret')
  })
})
