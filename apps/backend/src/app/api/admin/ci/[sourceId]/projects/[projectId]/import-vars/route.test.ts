import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'

const makeReq = (sourceId: string, projectId: string, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/ci/${sourceId}/projects/${projectId}/import-vars`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('POST /api/admin/ci/[sourceId]/projects/[projectId]/import-vars', () => {
  it('returns 401 without auth', async () => {
    const res = await POST(makeReq('1', '1'), { params: Promise.resolve({ sourceId: '1', projectId: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(makeReq('1', '1', auth), { params: Promise.resolve({ sourceId: '1', projectId: '1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await POST(makeReq('1', '1', auth), { params: Promise.resolve({ sourceId: '1', projectId: '1' }) })
    expect(res.status).toBe(403)
  })
})
