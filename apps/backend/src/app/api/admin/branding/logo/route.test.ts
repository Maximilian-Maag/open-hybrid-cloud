import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'

const makeFormReq = (auth?: string) => {
  const form = new FormData()
  // A real 8-byte PNG signature plus the start of the IHDR chunk. The upload path
  // now decides the type from the bytes (#143), and detectImageMime requires the
  // full signature and at least 12 bytes — a truncated 4-byte header is rejected
  // with 415, which is correct behaviour and used to be what this test asserted.
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ])
  form.append('logo', new Blob([png], { type: 'image/png' }), 'logo.png')
  return new NextRequest('http://localhost/api/admin/branding/logo', {
    method: 'PUT',
    body: form,
    headers: auth ? { authorization: auth } : {},
  })
}

describe('GET /api/admin/branding/logo', () => {
  it('returns 200 or 404 without auth (public endpoint)', async () => {
    const res = await GET()
    expect([200, 404]).toContain(res.status)
  })
})

describe('PUT /api/admin/branding/logo', () => {
  it('returns 401 without auth', async () => {
    const res = await PUT(makeFormReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await PUT(makeFormReq(auth))
    expect(res.status).toBe(403)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await PUT(makeFormReq(auth))
    expect(res.status).toBe(403)
  })

  it('uploads logo for root', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await PUT(makeFormReq(auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
