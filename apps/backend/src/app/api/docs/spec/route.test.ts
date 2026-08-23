import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'

const makeReq = (auth?: string) =>
  new NextRequest('http://localhost/api/docs/spec', {
    headers: auth ? { authorization: auth } : {},
  })

describe('GET /api/docs/spec', () => {
  it('returns 401 without auth', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns OpenAPI spec for any authenticated user', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await GET(makeReq(auth))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.openapi).toBeDefined()
  })

  it('documents the integration registry endpoints', async () => {
    // A route that is not in paths.ts is invisible to anyone reading the spec,
    // which is the only description of the API the frontend and any operator get.
    const auth = await makeAuthHeader(await createUser({ role: 'root' }))
    const body = await (await GET(makeReq(auth))).json()

    expect(Object.keys(body.paths['/admin/integrations'])).toEqual(
      expect.arrayContaining(['get', 'post']),
    )
    expect(Object.keys(body.paths['/admin/integrations/{id}'])).toEqual(
      expect.arrayContaining(['get', 'put', 'delete']),
    )
    expect(body.paths['/admin/integrations/{id}/probe'].post).toBeDefined()

    // The credential must not appear as a response field anywhere in the spec's
    // integration schema — hasCredential is what callers get.
    const listSchema = body.paths['/admin/integrations'].get.responses['200'].content[
      'application/json'
    ].schema
    expect(JSON.stringify(listSchema)).toContain('hasCredential')
    expect(Object.keys(listSchema.items.properties)).not.toContain('credential')
  })
})
