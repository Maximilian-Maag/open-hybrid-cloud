import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'

const makeReq = (url: string, auth?: string) =>
  new NextRequest(url, auth ? { headers: { authorization: auth } } : undefined)

describe('GET /api/audit', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/audit'))
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager role', async () => {
    const user = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/audit', auth))
    expect(res.status).toBe(403)
  })

  it('returns empty list when no audit entries exist', async () => {
    const user = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/audit', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual([])
    expect(body.total).toBe(0)
    expect(body.page).toBe(1)
  })

  it('returns pagination metadata', async () => {
    const user = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/audit?page=2&pageSize=10', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(10)
  })

  it('accepts filter params without error', async () => {
    const user = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(user)
    const res = await GET(
      makeReq('http://localhost/api/audit?action=order.created&from=2024-01-01', auth),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('root user can also view audit log', async () => {
    const user = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/audit', auth))
    expect(res.status).toBe(200)
  })
})
