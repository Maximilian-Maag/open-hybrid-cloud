import { describe, it, expect, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'
import { SECRET_KEY_ENV } from '@/lib/crypto/secrets'

const configuredKey = process.env[SECRET_KEY_ENV]
afterEach(() => {
  if (configuredKey === undefined) delete process.env[SECRET_KEY_ENV]
  else process.env[SECRET_KEY_ENV] = configuredKey
})

const URL_ = 'http://localhost/api/admin/integrations'

const makeReq = (method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(URL_, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

const rootAuth = () => createUser({ role: 'root' }).then(makeAuthHeader)

const valid = {
  kind: 'foreman',
  name: 'Foreman Prod',
  baseUrl: 'https://foreman.example.com',
  authType: 'bearer',
  credential: 'glpat-super-secret',
  failureMode: 'blocking',
}

describe('GET /api/admin/integrations', () => {
  it('returns 401 without an auth token', async () => {
    expect((await GET(makeReq())).status).toBe(401)
  })

  it('returns 403 for a project manager', async () => {
    const auth = await makeAuthHeader(await createUser({ role: 'project_manager' }))
    expect((await GET(makeReq('GET', undefined, auth))).status).toBe(403)
  })

  it('returns 403 for admin — the registry is root-only', async () => {
    // These rows hold credentials to systems that can provision and destroy
    // infrastructure, which is a narrower audience than the admin catalogue.
    const auth = await makeAuthHeader(await createUser({ role: 'admin' }))
    expect((await GET(makeReq('GET', undefined, auth))).status).toBe(403)
  })

  it('returns the list for root', async () => {
    const auth = await rootAuth()
    const res = await GET(makeReq('GET', undefined, auth))
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })

  it('never includes the credential in the response body', async () => {
    const auth = await rootAuth()
    expect((await POST(makeReq('POST', valid, auth))).status).toBe(201)

    const body = await (await GET(makeReq('GET', undefined, auth))).text()
    expect(body).not.toContain('glpat-super-secret')
    expect(body).not.toContain('credential"')
    expect(body).toContain('hasCredential')
  })
})

describe('POST /api/admin/integrations', () => {
  it('returns 401 without an auth token', async () => {
    expect((await POST(makeReq('POST', valid))).status).toBe(401)
  })

  it('returns 403 for admin', async () => {
    const auth = await makeAuthHeader(await createUser({ role: 'admin' }))
    expect((await POST(makeReq('POST', valid, auth))).status).toBe(403)
  })

  it('creates the integration for root without echoing the credential', async () => {
    const auth = await rootAuth()
    const res = await POST(makeReq('POST', valid, auth))
    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body).toMatchObject({ kind: 'foreman', name: 'Foreman Prod', hasCredential: true })
    expect(body).not.toHaveProperty('credential')
  })

  it('rejects an unknown kind', async () => {
    // Pushing Jenkins or an arbitrary system into this enum is what the CI
    // `provider` column already suffered from.
    const auth = await rootAuth()
    const res = await POST(makeReq('POST', { ...valid, kind: 'jenkins' }, auth))
    expect(res.status).toBe(400)
  })

  it('rejects a base URL that is not a URL', async () => {
    const auth = await rootAuth()
    expect((await POST(makeReq('POST', { ...valid, baseUrl: 'foreman' }, auth))).status).toBe(400)
  })

  it('rejects an unknown auth type and an unknown failure mode', async () => {
    const auth = await rootAuth()
    expect((await POST(makeReq('POST', { ...valid, authType: 'oauth2' }, auth))).status).toBe(400)
    expect((await POST(makeReq('POST', { ...valid, failureMode: 'maybe' }, auth))).status).toBe(400)
  })

  it('requires failureMode — it is deliberately not defaulted', async () => {
    // #111's fifth bullet: the answer to "does a failure here block
    // provisioning" has to be given, not inherited from a default.
    const auth = await rootAuth()
    const { failureMode: _omitted, ...withoutMode } = valid
    expect((await POST(makeReq('POST', withoutMode, auth))).status).toBe(400)
  })

  it('rejects a malformed body', async () => {
    const auth = await rootAuth()
    const req = new NextRequest(URL_, {
      method: 'POST',
      body: 'not json',
      headers: { 'content-type': 'application/json', authorization: auth },
    })
    expect((await POST(req)).status).toBe(400)
  })

  it('returns 409 on a second portal-wide integration of the same kind', async () => {
    const auth = await rootAuth()
    expect((await POST(makeReq('POST', valid, auth))).status).toBe(201)
    expect((await POST(makeReq('POST', { ...valid, name: 'Other' }, auth))).status).toBe(409)
  })

  it('returns 503 naming the env var when no encryption key is configured', async () => {
    delete process.env[SECRET_KEY_ENV]
    const auth = await rootAuth()
    const res = await POST(makeReq('POST', valid, auth))

    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain(SECRET_KEY_ENV)
  })

  it('checks the role before the encryption key', async () => {
    // Otherwise an unauthenticated caller could tell whether the deployment has
    // a key configured.
    delete process.env[SECRET_KEY_ENV]
    expect((await POST(makeReq('POST', valid))).status).toBe(401)
  })
})
