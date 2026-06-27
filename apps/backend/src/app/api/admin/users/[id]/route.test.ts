import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT, DELETE } from './route'
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

describe('GET /api/admin/users/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await GET(makeReq('http://localhost/api/admin/users/1'), {
      params: Promise.resolve({ id: '1' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role', async () => {
    const admin = await createUser({ role: 'admin' })
    const target = await createUser()
    const auth = await makeAuthHeader(admin)
    const res = await GET(
      makeReq(`http://localhost/api/admin/users/${target.id}`, 'GET', undefined, auth),
      { params: Promise.resolve({ id: String(target.id) }) },
    )
    expect(res.status).toBe(403)
  })

  it('returns 404 for non-existent user', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await GET(
      makeReq('http://localhost/api/admin/users/999999', 'GET', undefined, auth),
      { params: Promise.resolve({ id: '999999' }) },
    )
    expect(res.status).toBe(404)
  })

  it('returns user for root', async () => {
    const root = await createUser({ role: 'root' })
    const target = await createUser({ email: 'target@test.dev', role: 'project_manager' })
    const auth = await makeAuthHeader(root)
    const res = await GET(
      makeReq(`http://localhost/api/admin/users/${target.id}`, 'GET', undefined, auth),
      { params: Promise.resolve({ id: String(target.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.email).toBe('target@test.dev')
    expect(body).not.toHaveProperty('passwordHash')
  })
})

describe('PUT /api/admin/users/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await PUT(
      makeReq('http://localhost/api/admin/users/1', 'PUT', { name: 'Updated' }),
      { params: Promise.resolve({ id: '1' }) },
    )
    expect(res.status).toBe(401)
  })

  it('updates user name for root', async () => {
    const root = await createUser({ role: 'root' })
    const target = await createUser({ name: 'Original' })
    const auth = await makeAuthHeader(root)
    const res = await PUT(
      makeReq(`http://localhost/api/admin/users/${target.id}`, 'PUT', { name: 'Changed' }, auth),
      { params: Promise.resolve({ id: String(target.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Changed')
  })

  it('can update active status', async () => {
    const root = await createUser({ role: 'root' })
    const target = await createUser({ active: true })
    const auth = await makeAuthHeader(root)
    const res = await PUT(
      makeReq(`http://localhost/api/admin/users/${target.id}`, 'PUT', { active: false }, auth),
      { params: Promise.resolve({ id: String(target.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.active).toBe(false)
  })

  it('returns 404 for non-existent user', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await PUT(
      makeReq('http://localhost/api/admin/users/999999', 'PUT', { name: 'X' }, auth),
      { params: Promise.resolve({ id: '999999' }) },
    )
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/admin/users/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await DELETE(makeReq('http://localhost/api/admin/users/1', 'DELETE'), {
      params: Promise.resolve({ id: '1' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role', async () => {
    const admin = await createUser({ role: 'admin' })
    const target = await createUser()
    const auth = await makeAuthHeader(admin)
    const res = await DELETE(
      makeReq(`http://localhost/api/admin/users/${target.id}`, 'DELETE', undefined, auth),
      { params: Promise.resolve({ id: String(target.id) }) },
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 when trying to delete own account', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await DELETE(
      makeReq(`http://localhost/api/admin/users/${root.id}`, 'DELETE', undefined, auth),
      { params: Promise.resolve({ id: String(root.id) }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Cannot delete your own account')
  })

  it('deletes another user for root', async () => {
    const root = await createUser({ role: 'root' })
    const target = await createUser()
    const auth = await makeAuthHeader(root)
    const res = await DELETE(
      makeReq(`http://localhost/api/admin/users/${target.id}`, 'DELETE', undefined, auth),
      { params: Promise.resolve({ id: String(target.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns 404 for non-existent user', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await DELETE(
      makeReq('http://localhost/api/admin/users/999999', 'DELETE', undefined, auth),
      { params: Promise.resolve({ id: '999999' }) },
    )
    expect(res.status).toBe(404)
  })
})
