import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT, DELETE } from './route'
import { createUser, createCiSource, createEnvironment, makeAuthHeader } from '@/test/helpers'
import { db } from '@/lib/db/client'
import { deploymentEnvironments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const makeReq = (id: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(`http://localhost/api/admin/environments/${id}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('GET /api/admin/environments/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await GET(makeReq('1'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager (requires admin)', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq('1', 'GET', undefined, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 404 for unknown id', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('999999', 'GET', undefined, auth), { params: Promise.resolve({ id: '999999' }) })
    expect(res.status).toBe(404)
  })

  it('returns environment for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq(String(env.id), 'GET', undefined, auth), { params: Promise.resolve({ id: String(env.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(env.id)
  })

  // Issue #144 — the outbound trigger token, at admin level. See the POST/GET test
  // in ../route.test.ts for what the token is and why it is not returned.
  it('returns whether the outbound token is set, never the token', async () => {
    const admin = await createUser({ role: 'admin' })
    const ci = await createCiSource()
    const token = `glptt-detail-${Math.random().toString(36).slice(2)}`
    const env = await createEnvironment(ci.id, token)
    const auth = await makeAuthHeader(admin)

    const res = await GET(makeReq(String(env.id), 'GET', undefined, auth), { params: Promise.resolve({ id: String(env.id) }) })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(token)
    expect(JSON.parse(text)).toMatchObject({ id: env.id, webhookTokenSet: true })
  })
})

describe('PUT /api/admin/environments/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await PUT(makeReq('1', 'PUT', { name: 'X' }), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await PUT(makeReq('1', 'PUT', { name: 'X' }, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('updates environment for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const auth = await makeAuthHeader(admin)
    const res = await PUT(makeReq(String(env.id), 'PUT', { name: 'Updated Env' }, auth), { params: Promise.resolve({ id: String(env.id) }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Updated Env')
  })

  // Issue #144: the operator must still be able to REPLACE the outbound token even
  // though no read path hands it back — otherwise "never return it" would mean
  // "never rotate it".
  it('accepts a replacement webhook token without echoing it back', async () => {
    const admin = await createUser({ role: 'admin' })
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const auth = await makeAuthHeader(admin)
    const rotated = `glptt-rotated-${Math.random().toString(36).slice(2)}`

    const res = await PUT(
      makeReq(String(env.id), 'PUT', { webhookToken: rotated }, auth),
      { params: Promise.resolve({ id: String(env.id) }) },
    )
    expect(res.status).toBe(200)
    expect(await res.text()).not.toContain(rotated)

    // It really was stored — the response hiding it must not mean the write was a
    // no-op.
    const [stored] = await db
      .select({ webhookToken: deploymentEnvironments.webhookToken })
      .from(deploymentEnvironments)
      .where(eq(deploymentEnvironments.id, env.id))
    expect(stored.webhookToken).toBe(rotated)
  })
})

describe('DELETE /api/admin/environments/[id]', () => {
  it('returns 401 without auth', async () => {
    const res = await DELETE(makeReq('1', 'DELETE'), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await DELETE(makeReq('1', 'DELETE', undefined, auth), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(403)
  })

  it('deletes environment for admin', async () => {
    const admin = await createUser({ role: 'admin' })
    const ci = await createCiSource()
    const env = await createEnvironment(ci.id)
    const auth = await makeAuthHeader(admin)
    const res = await DELETE(makeReq(String(env.id), 'DELETE', undefined, auth), { params: Promise.resolve({ id: String(env.id) }) })
    expect(res.status).toBe(200)
  })
})
