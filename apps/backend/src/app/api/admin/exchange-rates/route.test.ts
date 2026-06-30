import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'

const makeReq = (auth?: string) =>
  new NextRequest('http://localhost/api/admin/exchange-rates', {
    headers: auth ? { authorization: auth } : {},
  })

describe('GET /api/admin/exchange-rates', () => {
  it('returns 401 without auth', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 200 for project_manager (requireAuth, no role restriction)', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq(auth))
    expect(res.status).toBe(200)
  })

  it('returns 200 for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq(auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})
