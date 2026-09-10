import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE } from './route'
import { createUser, createDelegation as seedDelegation, makeAuthHeader } from '@/test/helpers'

const req = (id: string, auth?: string) =>
  new NextRequest(`http://localhost/api/approvals/delegations/${id}`, {
    method: 'DELETE',
    headers: auth ? { authorization: auth } : undefined,
  })

const call = (id: string, auth?: string) =>
  DELETE(req(id, auth), { params: Promise.resolve({ delegationId: id }) })

describe('DELETE /api/approvals/delegations/[delegationId]', () => {
  it('returns 401 without a token', async () => {
    expect((await call('1')).status).toBe(401)
  })

  it('returns 403 for a project manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    expect((await call('1', await makeAuthHeader(pm))).status).toBe(403)
  })

  it('revokes the caller’s own delegation', async () => {
    const alice = await createUser({ role: 'admin' })
    const bob = await createUser({ role: 'admin' })
    const delegation = await seedDelegation(alice.id, bob.id, { startsInDays: 0, endsInDays: 3 })

    const res = await call(String(delegation.id), await makeAuthHeader(alice))
    expect(res.status).toBe(200)
  })

  it('refuses the substitute revoking a delegation granted to them', async () => {
    const alice = await createUser({ role: 'admin' })
    const bob = await createUser({ role: 'admin' })
    const delegation = await seedDelegation(alice.id, bob.id, { startsInDays: 0, endsInDays: 3 })

    expect((await call(String(delegation.id), await makeAuthHeader(bob))).status).toBe(403)
  })

  it('returns 404 for an id that is not one', async () => {
    const alice = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(alice)
    // `parseInt` would read "1abc" as 1 and revoke somebody else's row.
    expect((await call('1abc', auth)).status).toBe(404)
    expect((await call('999999', auth)).status).toBe(404)
  })
})
