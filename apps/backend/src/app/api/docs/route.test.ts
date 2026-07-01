import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'

const makeReq = (auth?: string) =>
  new NextRequest('http://localhost/api/docs', {
    headers: auth ? { authorization: auth } : {},
  })

describe('GET /api/docs', () => {
  it('returns 401 without auth', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns Swagger UI for any authenticated user', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq(auth))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('swagger-ui')
  })
})
