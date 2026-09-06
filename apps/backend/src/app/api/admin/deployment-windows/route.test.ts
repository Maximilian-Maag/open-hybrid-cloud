import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'
import { db } from '@/lib/db/client'
import { deploymentWindows } from '@/lib/db/schema'

const makeReq = (method = 'GET', body?: unknown, auth?: string) =>
  new NextRequest('http://localhost/api/admin/deployment-windows', {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  })

const authAs = async (role: 'root' | 'admin' | 'project_manager') =>
  makeAuthHeader(await createUser({ role, email: `dw-${role}-${Math.random()}@test.dev` }))

/**
 * Root only, both verbs (#330).
 *
 * Reading is restricted as well as writing, which is stricter than most admin
 * routes: the windows say when the company watches its own infrastructure, and
 * they are what an approved order waits on.
 */
describe('/api/admin/deployment-windows', () => {
  it('refuses an anonymous read', async () => {
    expect((await GET(makeReq())).status).toBe(401)
  })

  it.each(['admin', 'project_manager'] as const)('refuses %s', async (role) => {
    expect((await GET(makeReq('GET', undefined, await authAs(role)))).status).toBe(403)
    expect((await PUT(makeReq('PUT', { timeZone: 'UTC', windows: [] }, await authAs(role)))).status).toBe(403)
  })

  it('lets root read the current settings', async () => {
    const res = await GET(makeReq('GET', undefined, await authAs('root')))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ timeZone: 'UTC', windows: [] })
  })

  it('lets root replace the set and returns what was saved', async () => {
    const auth = await authAs('root')
    const res = await PUT(
      makeReq('PUT', { timeZone: 'Europe/Berlin', windows: [{ startMinute: 480, durationMinutes: 120 }] }, auth),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      timeZone: 'Europe/Berlin',
      windows: [{ startMinute: 480, durationMinutes: 120 }],
    })
  })

  it('rejects a window outside the day before it reaches the service', async () => {
    const res = await PUT(
      makeReq('PUT', { timeZone: 'UTC', windows: [{ startMinute: 2000, durationMinutes: 60 }] }, await authAs('root')),
    )
    expect(res.status).toBe(400)
    expect(await db.select().from(deploymentWindows)).toHaveLength(0)
  })

  it('rejects a body that is not a settings object', async () => {
    expect((await PUT(makeReq('PUT', { windows: 'all of them' }, await authAs('root')))).status).toBe(400)
  })

  // The service's answer, surfaced with its own status rather than a 500.
  it('passes an overlap rejection through as a 400', async () => {
    const res = await PUT(
      makeReq(
        'PUT',
        {
          timeZone: 'UTC',
          windows: [
            { startMinute: 480, durationMinutes: 120 },
            { startMinute: 540, durationMinutes: 60 },
          ],
        },
        await authAs('root'),
      ),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('overlap')
  })
})
