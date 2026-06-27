import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { verifyToken } from '@/lib/auth/jwt'
import { createUser } from '@/test/helpers'

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

describe('POST /api/auth/login', () => {
  it('returns a JWT token for valid credentials', async () => {
    await createUser({ email: 'login@test.dev', password: 'correct-pass', role: 'admin' })

    const res = await POST(makeRequest({ email: 'login@test.dev', password: 'correct-pass' }))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.token).toBeDefined()
    expect(body.user.email).toBe('login@test.dev')
    expect(body.user.role).toBe('admin')

    const session = await verifyToken(body.token)
    expect(session?.email).toBe('login@test.dev')
  })

  it('returns 401 for wrong password', async () => {
    await createUser({ email: 'wrongpw@test.dev', password: 'correct-pass' })

    const res = await POST(makeRequest({ email: 'wrongpw@test.dev', password: 'wrong-pass' }))
    expect(res.status).toBe(401)

    const body = await res.json()
    expect(body.error).toBe('Invalid credentials')
  })

  it('returns 401 for non-existent user', async () => {
    const res = await POST(makeRequest({ email: 'nobody@test.dev', password: 'any-pass' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 for inactive user', async () => {
    await createUser({ email: 'inactive@test.dev', password: 'correct-pass', active: false })

    const res = await POST(makeRequest({ email: 'inactive@test.dev', password: 'correct-pass' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid email format', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email', password: 'pass' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing password', async () => {
    const res = await POST(makeRequest({ email: 'user@test.dev' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for non-JSON body', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: 'not json',
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('does not return the password hash in response', async () => {
    await createUser({ email: 'nohash@test.dev', password: 'secret' })
    const res = await POST(makeRequest({ email: 'nohash@test.dev', password: 'secret' }))
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('$2')
  })
})
