import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { createUser, createCategory, makeAuthHeader } from '@/test/helpers'

const makeReq = (url: string, method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('GET /api/admin/categories', () => {
  it('returns 401 without auth token', async () => {
    const res = await GET(makeReq('http://localhost/api/admin/categories'))
    expect(res.status).toBe(401)
  })

  /*
   * These two used to assert 403, and that is what the bug was.
   *
   * The catalogue page fetches this list to build its category filter, in the
   * same `Promise.all` as the products themselves — so a 403 here did not cost
   * the filter, it rendered the entire shop as an error. For every project
   * manager and every admin. Only `root` could load the catalogue, and `root` is
   * the account the operator reports bugs from, which is why it survived.
   *
   * Asserted per role rather than once, because the roles failed for different
   * reasons and both need to stay fixed: a project manager is the account that
   * shops here, and an admin outranks one but was refused just the same.
   */
  it('returns the category list to a project_manager — the account that shops here', async () => {
    const pm = await createUser({ role: 'project_manager' })
    await createCategory('Category A')
    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq('http://localhost/api/admin/categories', 'GET', undefined, auth))
    expect(res.status).toBe(200)
    expect((await res.json()).map((c: { name: string }) => c.name)).toContain('Category A')
  })

  it('returns the category list to an admin', async () => {
    const admin = await createUser({ role: 'admin' })
    await createCategory('Category A')
    const auth = await makeAuthHeader(admin)
    const res = await GET(makeReq('http://localhost/api/admin/categories', 'GET', undefined, auth))
    expect(res.status).toBe(200)
    expect((await res.json()).map((c: { name: string }) => c.name)).toContain('Category A')
  })

  it('returns categories list for root', async () => {
    const root = await createUser({ role: 'root' })
    await createCategory('Category A')
    await createCategory('Category B')

    const auth = await makeAuthHeader(root)
    const res = await GET(makeReq('http://localhost/api/admin/categories', 'GET', undefined, auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.length).toBe(2)
  })
})

describe('POST /api/admin/categories', () => {
  it('returns 401 without auth token', async () => {
    const res = await POST(makeReq('http://localhost/api/admin/categories', 'POST', { name: 'Cat' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(
      makeReq('http://localhost/api/admin/categories', 'POST', { name: 'Cat' }, auth),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 for missing name', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await POST(makeReq('http://localhost/api/admin/categories', 'POST', {}, auth))
    expect(res.status).toBe(400)
  })

  it('creates category for root user', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await POST(
      makeReq('http://localhost/api/admin/categories', 'POST', { name: 'New Cat', displayOrder: 1 }, auth),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe('New Cat')
    expect(body.displayOrder).toBe(1)
    expect(body.id).toBeDefined()
  })
})
