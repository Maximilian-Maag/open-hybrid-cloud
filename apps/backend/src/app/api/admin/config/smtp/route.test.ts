import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'

const makeReq = (method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest('http://localhost/api/admin/config/smtp', {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

const validPayload = { host: 'smtp.example.com', port: 587, from: 'noreply@example.com', tls: true }

describe('GET /api/admin/config/smtp', () => {
  it('returns 401 without auth', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('GET', undefined, auth))
    expect(res.status).toBe(403)
  })

  it('returns config for root', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await GET(makeReq('GET', undefined, auth))
    expect(res.status).toBe(200)
  })
})

describe('PUT /api/admin/config/smtp', () => {
  it('returns 401 without auth', async () => {
    const res = await PUT(makeReq('PUT', validPayload))
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await PUT(makeReq('PUT', validPayload, auth))
    expect(res.status).toBe(403)
  })

  it('updates config for root', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await PUT(makeReq('PUT', validPayload, auth))
    expect(res.status).toBe(200)
  })

  it('returns 400 for invalid payload', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await PUT(makeReq('PUT', { host: '' }, auth))
    expect(res.status).toBe(400)
  })
})

/*
 * SMTP used to be a one-way door: `host` and `from` were `.min(1)`, so an
 * operator who typed the wrong hostname could replace it but never remove it
 * (#317). An empty host is what the runtime already means by "not configured" —
 * `lib/notification` returns null for it — so this is the schema catching up
 * with the behaviour, not a new state.
 */
describe('turning SMTP off', () => {
  const root = async () => makeAuthHeader(await createUser({ role: 'root' }))

  it('accepts an empty host and from, and the config reads back empty', async () => {
    const auth = await root()
    expect((await PUT(makeReq('PUT', validPayload, auth))).status).toBe(200)

    const cleared = await PUT(makeReq('PUT', { host: '', port: 587, from: '', tls: true }, auth))

    expect(cleared.status).toBe(200)
    const after = await (await GET(makeReq('GET', undefined, auth))).json()
    expect(after).toMatchObject({ host: '', from: '' })
  })

  /*
   * Half a pair is not a configuration anyone wants — it is a save that went
   * wrong, and without this it fails at the first send instead of at the form.
   */
  it('refuses a host with no from address', async () => {
    const auth = await root()

    const res = await PUT(makeReq('PUT', { host: 'smtp.example.com', port: 587, from: '', tls: true }, auth))

    expect(res.status).toBe(400)
  })

  it('refuses a from address with no host', async () => {
    const auth = await root()

    const res = await PUT(makeReq('PUT', { host: '', port: 587, from: 'noreply@example.com', tls: true }, auth))

    expect(res.status).toBe(400)
  })
})
