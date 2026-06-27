import { describe, it, expect, vi } from 'vitest'
import type * as ExchangeRatesService from '@/lib/services/admin/exchangeRates'

vi.mock('@/lib/services/admin/exchangeRates', async (importOriginal) => {
  const mod = await importOriginal<typeof ExchangeRatesService>()
  return { ...mod, refreshExchangeRates: vi.fn().mockResolvedValue({ ok: true, data: [] }) }
})

import { NextRequest } from 'next/server'
import { POST } from './route'
import { createUser, makeAuthHeader } from '@/test/helpers'

const makeReq = (auth?: string) =>
  new NextRequest('http://localhost/api/admin/exchange-rates/refresh', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  })

describe('POST /api/admin/exchange-rates/refresh', () => {
  it('returns 401 without auth', async () => {
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 for admin role (requires root)', async () => {
    const admin = await createUser({ role: 'admin' })
    const auth = await makeAuthHeader(admin)
    const res = await POST(makeReq(auth))
    expect(res.status).toBe(403)
  })

  it('returns 403 for project_manager', async () => {
    const pm = await createUser({ role: 'project_manager' })
    const auth = await makeAuthHeader(pm)
    const res = await POST(makeReq(auth))
    expect(res.status).toBe(403)
  })

  it('triggers refresh for root', async () => {
    const root = await createUser({ role: 'root' })
    const auth = await makeAuthHeader(root)
    const res = await POST(makeReq(auth))
    expect(res.status).toBe(200)
  })
})
