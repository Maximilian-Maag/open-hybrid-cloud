import { describe, it, expect } from 'vitest'
import { GET } from './route'
import { db } from '@/lib/db/client'
import { exchangeRates } from '@/lib/db/schema'

describe('GET /api/public/exchange-rates', () => {
  it('returns the persisted rates without requiring authentication', async () => {
    await db.insert(exchangeRates).values({ currencyCode: 'USD', rate: '1.100000' })
    await db.insert(exchangeRates).values({ currencyCode: 'GBP', rate: '0.860000' })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json() as Array<{ currencyCode: string; rate: string }>
    const codes = body.map((r) => r.currencyCode).sort()
    expect(codes).toContain('USD')
    expect(codes).toContain('GBP')
  })

  it('returns 200 with an empty array when no rates are configured', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})
