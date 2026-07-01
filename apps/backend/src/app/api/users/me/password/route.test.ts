import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const makeReq = (url: string, body: unknown, auth?: string) =>
  new NextRequest(url, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  })

describe('PUT /api/users/me/password', () => {
  it('returns 401 without auth token', async () => {
    const res = await PUT(
      makeReq('http://localhost/api/users/me/password', {
        currentPassword: 'old',
        newPassword: 'newpassword123',
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 for missing fields', async () => {
    const user = await createUser()
    const auth = await makeAuthHeader(user)
    const res = await PUT(makeReq('http://localhost/api/users/me/password', {}, auth))
    expect(res.status).toBe(400)
  })

  it('returns 400 for newPassword shorter than 8 chars', async () => {
    const user = await createUser({ password: 'correct-pass' })
    const auth = await makeAuthHeader(user)
    const res = await PUT(
      makeReq(
        'http://localhost/api/users/me/password',
        { currentPassword: 'correct-pass', newPassword: 'short' },
        auth,
      ),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for wrong current password', async () => {
    const user = await createUser({ password: 'correct-pass' })
    const auth = await makeAuthHeader(user)
    const res = await PUT(
      makeReq(
        'http://localhost/api/users/me/password',
        { currentPassword: 'wrong-pass', newPassword: 'newpassword123' },
        auth,
      ),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Current password is incorrect')
  })

  it('changes password with correct current password', async () => {
    const user = await createUser({ password: 'correct-pass' })
    const auth = await makeAuthHeader(user)
    const res = await PUT(
      makeReq(
        'http://localhost/api/users/me/password',
        { currentPassword: 'correct-pass', newPassword: 'new-secure-pass' },
        auth,
      ),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    // Verify new password hash in DB
    const rows = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, user.id))
    const valid = await bcrypt.compare('new-secure-pass', rows[0]?.passwordHash ?? '')
    expect(valid).toBe(true)
  })
})
