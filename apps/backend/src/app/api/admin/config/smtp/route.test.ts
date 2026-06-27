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
