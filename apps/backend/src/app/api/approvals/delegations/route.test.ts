import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import { createUser, createDelegation as seedDelegation, makeAuthHeader } from '@/test/helpers'

const getReq = (auth?: string) =>
  new NextRequest('http://localhost/api/approvals/delegations', {
    headers: auth ? { authorization: auth } : undefined,
  })

const postReq = (body: unknown, auth?: string) =>
  new NextRequest('http://localhost/api/approvals/delegations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  })

/** ISO date `offset` days from today. */
const day = (offset: number): string => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

describe('GET /api/approvals/delegations', () => {
  it('returns 401 without a token', async () => {
    expect((await GET(getReq())).status).toBe(401)
  })

  it('returns 403 for a project manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    expect((await GET(getReq(await makeAuthHeader(pm)))).status).toBe(403)
  })

  it('returns the caller’s own and received delegations plus the candidates', async () => {
    const alice = await createUser({ role: 'admin', email: 'alice@test.dev', name: 'Alice' })
    const bob = await createUser({ role: 'admin', email: 'bob@test.dev', name: 'Bob' })
    await seedDelegation(alice.id, bob.id, { startsInDays: 0, endsInDays: 3 })

    const res = await GET(getReq(await makeAuthHeader(alice)))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mine).toHaveLength(1)
    expect(body.mine[0].active).toBe(true)
    expect(body.grantedToMe).toEqual([])
    expect(body.candidates.map((c: { email: string }) => c.email)).toEqual(['bob@test.dev'])
  })
})

describe('POST /api/approvals/delegations', () => {
  it('returns 401 without a token', async () => {
    expect((await POST(postReq({}))).status).toBe(401)
  })

  it('returns 403 for a project manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    expect((await POST(postReq({}, await makeAuthHeader(pm)))).status).toBe(403)
  })

  it('returns 403 for root — it does not participate in the approval workflow', async () => {
    // requireRole('admin') admits root by rank, so the refusal has to come from
    // the service. This asserts the route does not accidentally allow it.
    const root = await createUser({ role: 'root' })
    const admin = await createUser({ role: 'admin' })
    const res = await POST(
      postReq({ toUserId: admin.id, startsOn: day(1), endsOn: day(2) }, await makeAuthHeader(root)),
    )
    expect(res.status).toBe(403)
  })

  it('rejects a malformed body with 400 before it reaches the service', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    for (const body of [
      {},
      { toUserId: 'abc', startsOn: day(1), endsOn: day(2) },
      { toUserId: 1, startsOn: '01/09/2026', endsOn: day(2) },
      { toUserId: -1, startsOn: day(1), endsOn: day(2) },
    ]) {
      expect((await POST(postReq(body, auth))).status, JSON.stringify(body)).toBe(400)
    }
  })

  it('creates a delegation and answers 201 with the row', async () => {
    const alice = await createUser({ role: 'admin', email: 'alice@test.dev', name: 'Alice' })
    const bob = await createUser({ role: 'admin', email: 'bob@test.dev', name: 'Bob' })

    const res = await POST(
      postReq({ toUserId: bob.id, startsOn: day(1), endsOn: day(4) }, await makeAuthHeader(alice)),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({
      fromUserId: alice.id,
      toUserId: bob.id,
      startsOn: day(1),
      endsOn: day(4),
      active: false,
    })
  })

  it('surfaces an overlap as 409', async () => {
    const alice = await createUser({ role: 'admin' })
    const bob = await createUser({ role: 'admin' })
    const carol = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(alice)

    await POST(postReq({ toUserId: bob.id, startsOn: day(1), endsOn: day(10) }, auth))
    const res = await POST(postReq({ toUserId: carol.id, startsOn: day(5), endsOn: day(12) }, auth))
    expect(res.status).toBe(409)
  })
})
