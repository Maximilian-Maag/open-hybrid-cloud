import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { createUser, createCiSource, createEnvironment, makeAuthHeader } from '@/test/helpers'

const makeReq = (id: string, method: 'GET' | 'POST', auth?: string) =>
  new NextRequest(`http://localhost/api/admin/environments/${id}/callback-secret`, {
    method,
    headers: auth ? { authorization: auth } : {},
  })

describe('GET /api/admin/environments/[id]/callback-secret', () => {
  it('requires root role', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('1', 'GET', auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('returns the current secret so the operator can copy it', async () => {
    const root = await createUser({ role: 'root' })
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id, 'trigger-tok')
    const auth = await makeAuthHeader(root)

    const res = await GET(makeReq(String(env.id), 'GET', auth), { params: Promise.resolve({ id: String(env.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    // createEnvironment helper mirrors migration 0004's backfill: callback_secret
    // starts equal to webhook_token for legacy setups.
    expect(body.callbackSecret).toBe('trigger-tok')
  })

  it('returns 404 for unknown env id', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await GET(makeReq('999999', 'GET', auth), { params: Promise.resolve({ id: '999999' }) })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/admin/environments/[id]/callback-secret (rotate)', () => {
  it('replaces the secret with a new random value and returns it once', async () => {
    const root = await createUser({ role: 'root' })
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id, 'legacy-tok')
    const auth = await makeAuthHeader(root)

    const before = await GET(makeReq(String(env.id), 'GET', auth), { params: Promise.resolve({ id: String(env.id) }) })
    const beforeBody = await before.json()

    const res = await POST(makeReq(String(env.id), 'POST', auth), { params: Promise.resolve({ id: String(env.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.callbackSecret).toMatch(/^ohc-cb-[0-9a-f]{64}$/)
    expect(body.callbackSecret).not.toBe(beforeBody.callbackSecret)

    const after = await GET(makeReq(String(env.id), 'GET', auth), { params: Promise.resolve({ id: String(env.id) }) })
    const afterBody = await after.json()
    expect(afterBody.callbackSecret).toBe(body.callbackSecret)
  })

  it('requires root role', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await POST(makeReq('1', 'POST', auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })
})
