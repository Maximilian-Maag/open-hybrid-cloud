import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT, DELETE } from './route'
import { createUser, createProject, makeAuthHeader } from '@/test/helpers'

const makeReq = (url: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('GET /api/projects/[id]', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/projects/1'), {
      params: Promise.resolve({ id: '1' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 404 for non-existent project', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/projects/999999', 'GET', undefined, auth), {
      params: Promise.resolve({ id: '999999' }),
    })
    expect(res.status).toBe(404)
  })

  it('admin can view any project', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })
    const project = await createProject(pm.id)

    const auth = await makeAuthHeader(admin)
    const res = await GET(
      makeReq(`http://localhost/api/projects/${project.id}`, 'GET', undefined, auth),
      { params: Promise.resolve({ id: String(project.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(project.id)
  })

  it('project_manager can view own project', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const project = await createProject(pm.id)

    const auth = await makeAuthHeader(pm)
    const res = await GET(
      makeReq(`http://localhost/api/projects/${project.id}`, 'GET', undefined, auth),
      { params: Promise.resolve({ id: String(project.id) }) },
    )
    expect(res.status).toBe(200)
  })

  it('project_manager cannot view another PM project', async () => {
    const pm1 = await createUser({ role: 'project_manager' })
    const pm2 = await createUser({ role: 'project_manager' })
    const project = await createProject(pm2.id)

    const auth = await makeAuthHeader(pm1)
    const res = await GET(
      makeReq(`http://localhost/api/projects/${project.id}`, 'GET', undefined, auth),
      { params: Promise.resolve({ id: String(project.id) }) },
    )
    expect(res.status).toBe(403)
  })
})

describe('PUT /api/projects/[id]', () => {
  it('returns 401 without auth token', async () => {
    const res = await PUT(
      makeReq('http://localhost/api/projects/1', 'PUT', { name: 'Updated' }),
      { params: Promise.resolve({ id: '1' }) },
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 for non-existent project', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await PUT(
      makeReq('http://localhost/api/projects/999999', 'PUT', { name: 'Updated' }, auth),
      { params: Promise.resolve({ id: '999999' }) },
    )
    expect(res.status).toBe(404)
  })

  it('project_manager cannot update another PM project', async () => {
    const pm1 = await createUser({ role: 'project_manager' })
    const pm2 = await createUser({ role: 'project_manager' })
    const project = await createProject(pm2.id)

    const auth = await makeAuthHeader(pm1)
    const res = await PUT(
      makeReq(`http://localhost/api/projects/${project.id}`, 'PUT', { name: 'Hacked' }, auth),
      { params: Promise.resolve({ id: String(project.id) }) },
    )
    expect(res.status).toBe(403)
  })

  it('project_manager can update own project', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const project = await createProject(pm.id)

    const auth = await makeAuthHeader(pm)
    const res = await PUT(
      makeReq(`http://localhost/api/projects/${project.id}`, 'PUT', { name: 'Renamed' }, auth),
      { params: Promise.resolve({ id: String(project.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Renamed')
  })

  it('admin can update any project', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })
    const project = await createProject(pm.id)

    const auth = await makeAuthHeader(admin)
    const res = await PUT(
      makeReq(
        `http://localhost/api/projects/${project.id}`,
        'PUT',
        { name: 'Admin Update' },
        auth,
      ),
      { params: Promise.resolve({ id: String(project.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Admin Update')
  })
})

describe('DELETE /api/projects/[id]', () => {
  it('returns 401 without auth token', async () => {
    const res = await DELETE(makeReq('http://localhost/api/projects/1', 'DELETE'), {
      params: Promise.resolve({ id: '1' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const project = await createProject(pm.id)

    const auth = await makeAuthHeader(pm)
    const res = await DELETE(
      makeReq(`http://localhost/api/projects/${project.id}`, 'DELETE', undefined, auth),
      { params: Promise.resolve({ id: String(project.id) }) },
    )
    expect(res.status).toBe(403)
  })

  it('admin can delete a project', async () => {
    const admin = await createUser({ role: 'admin' })
    const pm = await createUser({ role: 'project_manager' })
    const project = await createProject(pm.id)

    const auth = await makeAuthHeader(admin)
    const res = await DELETE(
      makeReq(`http://localhost/api/projects/${project.id}`, 'DELETE', undefined, auth),
      { params: Promise.resolve({ id: String(project.id) }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns 404 for non-existent project', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await DELETE(
      makeReq('http://localhost/api/projects/999999', 'DELETE', undefined, auth),
      { params: Promise.resolve({ id: '999999' }) },
    )
    expect(res.status).toBe(404)
  })
})
