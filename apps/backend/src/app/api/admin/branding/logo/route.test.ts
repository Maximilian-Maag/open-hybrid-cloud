import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'

const makeFormReq = (auth?: string) => {
  const form = new FormData()
  form.append('logo', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'logo.png')
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
