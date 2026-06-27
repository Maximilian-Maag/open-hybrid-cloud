import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'

const makeReq = (url: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('GET /api/admin/ci-sources', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/admin/ci-sources'))
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/admin/ci-sources', 'GET', undefined, auth))
    expect(res.status).toBe(403)
  })

  it('returns ci-sources list for root', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await GET(makeReq('http://localhost/api/admin/ci-sources', 'GET', undefined, auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('does not include accessToken in response', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const createRes = await POST(
      makeReq(
        'http://localhost/api/admin/ci-sources',
        'POST',
        {
          name: 'MyGitLab',
          url: 'https://gitlab.example.com',
          accessToken: 'super-secret',
          provider: 'gitlab',
        },
        auth,
      ),
    )
    expect(createRes.status).toBe(201)

    const listRes = await GET(makeReq('http://localhost/api/admin/ci-sources', 'GET', undefined, auth))
    const body = await listRes.text()
    expect(body).not.toContain('super-secret')
    expect(body).not.toContain('accessToken')
  })
})

describe('POST /api/admin/ci-sources', () => {
  it('returns 401 without auth token', async () => {
    const res = await POST(
      makeReq('http://localhost/api/admin/ci-sources', 'POST', {
        name: 'Source',
        url: 'https://gitlab.example.com',
        accessToken: 'tok',
        provider: 'gitlab',
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq(
        'http://localhost/api/admin/ci-sources',
        'POST',
        { name: 'S', url: 'https://gitlab.example.com', accessToken: 'tok', provider: 'gitlab' },
        auth,
      ),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid URL', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await POST(
      makeReq(
        'http://localhost/api/admin/ci-sources',
        'POST',
        { name: 'S', url: 'not-a-url', accessToken: 'tok', provider: 'gitlab' },
        auth,
      ),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid provider', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await POST(
      makeReq(
        'http://localhost/api/admin/ci-sources',
        'POST',
        {
          name: 'S',
          url: 'https://gitlab.example.com',
          accessToken: 'tok',
          provider: 'jenkins',
        },
        auth,
      ),
    )
    expect(res.status).toBe(400)
  })

  it('creates ci-source for root', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await POST(
      makeReq(
        'http://localhost/api/admin/ci-sources',
        'POST',
        {
          name: 'My GitLab',
          url: 'https://gitlab.example.com',
          accessToken: 'my-token',
          provider: 'gitlab',
        },
        auth,
      ),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe('My GitLab')
    expect(body.provider).toBe('gitlab')
    expect(body).not.toHaveProperty('accessToken')
  })
})
