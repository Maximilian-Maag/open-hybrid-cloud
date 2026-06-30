import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT } from './route'
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

describe('GET /api/users/me', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/users/me'))
    expect(res.status).toBe(401)
  })

  it('returns own profile', async () => {
    const user = await createUser({ email: 'me@test.dev', name: 'Me User', role: 'project_manager' })
    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/users/me', 'GET', undefined, auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.email).toBe('me@test.dev')
    expect(body.name).toBe('Me User')
    expect(body.role).toBe('project_manager')
  })

  it('does not return password hash', async () => {
    const user = await createUser({ email: 'nohash@test.dev' })
    const auth = await makeAuthHeader(user)
    const res = await GET(makeReq('http://localhost/api/users/me', 'GET', undefined, auth))
    const text = await res.text()
    expect(text).not.toContain('$2')
    expect(text).not.toContain('passwordHash')
  })
})

describe('PUT /api/users/me', () => {
  it('returns 401 without auth token', async () => {
    const res = await PUT(makeReq('http://localhost/api/users/me', 'PUT', { name: 'New Name' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for missing name', async () => {
    const user = await createUser()
    const auth = await makeAuthHeader(user)
    const res = await PUT(makeReq('http://localhost/api/users/me', 'PUT', {}, auth))
    expect(res.status).toBe(400)
  })

  it('returns 400 for empty name', async () => {
    const user = await createUser()
    const auth = await makeAuthHeader(user)
    const res = await PUT(makeReq('http://localhost/api/users/me', 'PUT', { name: '' }, auth))
    expect(res.status).toBe(400)
  })

  it('updates own name', async () => {
    const user = await createUser({ name: 'Original Name' })
    const auth = await makeAuthHeader(user)
    const res = await PUT(
      makeReq('http://localhost/api/users/me', 'PUT', { name: 'Updated Name' }, auth),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Updated Name')
  })
})
