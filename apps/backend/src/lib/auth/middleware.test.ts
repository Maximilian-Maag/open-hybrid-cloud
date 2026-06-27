import { describe, it, expect } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { signToken } from './jwt'
import { getSession, requireAuth, requireRole, isAuth } from './middleware'
import type { SessionUser } from '@open-hybrid-cloud/types'

const makeReq = (token?: string): NextRequest =>
  new NextRequest('http://localhost/api/test', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

const adminUser: SessionUser = { id: 1, email: 'admin@test.dev', name: 'Admin', role: 'admin' }
const pmUser: SessionUser = { id: 2, email: 'pm@test.dev', name: 'PM', role: 'project_manager' }
const rootUser: SessionUser = { id: 3, email: 'root@test.dev', name: 'Root', role: 'root' }

describe('getSession', () => {
  it('returns null with no authorization header', async () => {
    expect(await getSession(makeReq())).toBeNull()
  })

  it('returns null for a non-Bearer header', async () => {
    const req = new NextRequest('http://localhost/', { headers: { authorization: 'Basic abc' } })
    expect(await getSession(req)).toBeNull()
  })

  it('returns null for an invalid token', async () => {
    expect(await getSession(makeReq('garbage'))).toBeNull()
  })

  it('returns the user from a valid token', async () => {
    const token = await signToken(adminUser)
    const session = await getSession(makeReq(token))
    expect(session).toMatchObject(adminUser)
  })
})

describe('requireAuth', () => {
  it('returns 401 with no token', async () => {
    const result = await requireAuth(makeReq())
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })

  it('returns the user with a valid token', async () => {
    const token = await signToken(adminUser)
    const result = await requireAuth(makeReq(token))
    expect(isAuth(result)).toBe(true)
  })
})

describe('requireRole', () => {
  it('returns 401 when not authenticated', async () => {
    const result = await requireRole('admin')(makeReq())
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })

  it('returns 403 when role rank is too low', async () => {
    const token = await signToken(pmUser)
    const result = await requireRole('admin')(makeReq(token))
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
  })

  it('passes when user has exact minimum role', async () => {
    const token = await signToken(adminUser)
    const result = await requireRole('admin')(makeReq(token))
    expect(isAuth(result)).toBe(true)
    if (isAuth(result)) expect(result.role).toBe('admin')
  })

  it('passes when user role exceeds minimum', async () => {
    const token = await signToken(rootUser)
    expect(isAuth(await requireRole('admin')(makeReq(token)))).toBe(true)
    expect(isAuth(await requireRole('project_manager')(makeReq(token)))).toBe(true)
  })

  it('project_manager passes project_manager-level check', async () => {
    const token = await signToken(pmUser)
    const result = await requireRole('project_manager')(makeReq(token))
    expect(isAuth(result)).toBe(true)
  })
})

describe('isAuth', () => {
  it('returns true for a SessionUser object', () => {
    expect(isAuth(adminUser)).toBe(true)
  })

  it('returns false for a NextResponse', () => {
    expect(isAuth(NextResponse.json({ error: 'x' }, { status: 401 }))).toBe(false)
  })
})
