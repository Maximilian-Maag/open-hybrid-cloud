import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'

const makeReq = (url: string, auth?: string) =>
  new NextRequest(url, auth ? { headers: { authorization: auth } } : undefined)

describe('GET /api/audit/export', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/audit/export'))
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager role', async () => {
    const user = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/audit/export', auth))
    expect(res.status).toBe(403)
  })

  it('returns CSV with correct Content-Type and filename for admin', async () => {
    const user = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/audit/export', auth))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/csv/)
    expect(res.headers.get('content-disposition')).toContain('audit.csv')
  })

  it('returns CSV containing header row', async () => {
    const user = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/audit/export', auth))
    const text = await res.text()
    expect(text).toContain('id,userId,userName,action,entityId,details,createdAt')
  })

  it('returns PDF with correct Content-Type and filename when ?format=pdf', async () => {
    const user = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/audit/export?format=pdf', auth))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('audit.pdf')
  })

  it('accepts action filter param without error', async () => {
    const user = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(user)
    const res = await GET(
      makeReq('http://localhost/api/audit/export?action=order', auth),
    )
    expect(res.status).toBe(200)
  })

  it('root user can also export', async () => {
    const user = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/audit/export', auth))
    // root passes requireRole('admin') because root rank > admin rank
    expect(res.status).toBe(200)
  })
})
