import { describe, it, expect } from 'vitest'
import { signToken, verifyToken } from './jwt'
import type { SessionUser } from '@open-hybrid-cloud/types'

const user: SessionUser = { id: 1, email: 'test@example.com', name: 'Test User', role: 'admin' }

describe('signToken / verifyToken', () => {
  it('round-trips a user payload', async () => {
    const token = await signToken(user)
    const result = await verifyToken(token)
    expect(result).toMatchObject(user)
  })

  it('returns null for a garbage string', async () => {
    expect(await verifyToken('not-a-token')).toBeNull()
  })

  it('returns null for a tampered signature', async () => {
    const token = await signToken(user)
    const tampered = token.slice(0, -5) + 'XXXXX'
    expect(await verifyToken(tampered)).toBeNull()
  })

  it('produces different tokens for different users', async () => {
    const a = await signToken(user)
    const b = await signToken({ ...user, id: 2 })
    expect(a).not.toBe(b)
  })

  it('preserves all user fields', async () => {
    const rootUser: SessionUser = { id: 99, email: 'root@example.com', name: 'Root', role: 'root' }
    const token = await signToken(rootUser)
    expect(await verifyToken(token)).toMatchObject(rootUser)
  })
})
