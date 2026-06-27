import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { createUser, createProject, makeAuthHeader } from '@/test/helpers'

const makeGetReq = (url: string, auth?: string) =>
  new NextRequest(url, auth ? { headers: { authorization: auth } } : undefined)

const makePostReq = (url: string, body: unknown, auth?: string) =>
  new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('GET /api/projects', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeGetReq('http://localhost/api/projects'))
    expect(res.status).toBe(401)
  })

  it('admin sees all projects', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm1 = await createUser({ role: 'project_manager' })
    const pm2 = await createUser({ role: 'project_manager' })

    await createProject(pm1.id)
    await createProject(pm2.id)

    const auth = await makeAuthHeader(admin)
    const res = await GET(makeGetReq('http://localhost/api/projects', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.length).toBe(2)
  })

  it('project_manager only sees own projects', async () => {
    const pm1 = await createUser({ role: 'project_manager' })
    const pm2 = await createUser({ role: 'project_manager' })

    await createProject(pm1.id)
    await createProject(pm2.id)

    const auth = await makeAuthHeader(pm1)
    const res = await GET(makeGetReq('http://localhost/api/projects', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.length).toBe(1)
    expect(body[0].ownerId).toBe(pm1.id)
  })

  it('returns empty array when no projects exist', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await GET(makeGetReq('http://localhost/api/projects', auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  })
})

describe('POST /api/projects', () => {
  it('returns 401 without auth token', async () => {
    const res = await POST(makePostReq('http://localhost/api/projects', { name: 'Test' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for missing name', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await POST(makePostReq('http://localhost/api/projects', {}, auth))
    expect(res.status).toBe(400)
  })

  it('returns 400 for empty name', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await POST(makePostReq('http://localhost/api/projects', { name: '' }, auth))
    expect(res.status).toBe(400)
  })

  it('project_manager creates project owned by themselves', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await POST(
      makePostReq('http://localhost/api/projects', { name: 'My Project' }, auth),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe('My Project')
    expect(body.ownerId).toBe(pm.id)
  })

  it('admin creates project owned by themselves', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makePostReq('http://localhost/api/projects', { name: 'Admin Project', description: 'Desc' }, auth),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ownerId).toBe(admin.id)
    expect(body.description).toBe('Desc')
  })
})
