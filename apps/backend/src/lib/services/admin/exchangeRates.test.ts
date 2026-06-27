import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/exchange', () => ({
  refreshRates: vi.fn().mockResolvedValue(undefined),
}))

import { getExchangeRates, refreshExchangeRates } from './exchangeRates'
import { refreshRates } from '@/lib/exchange'
import { db } from '@/lib/db/client'
import { exchangeRates } from '@/lib/db/schema'

const mockedRefresh = vi.mocked(refreshRates)

beforeEach(() => {
  mockedRefresh.mockReset().mockResolvedValue(undefined)
})

describe('getExchangeRates', () => {
  it('returns rates ordered by currency code (empty after truncate)', async () => {
    const result = await getExchangeRates()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })

  it('returns seeded rates when present', async () => {
    await db
      .insert(exchangeRates)
      .values([
        { currencyCode: 'EUR', rate: '1.000000' },
        { currencyCode: 'USD', rate: '1.100000' },
      ])

    const result = await getExchangeRates()
    expect(result.ok).toBe(true)
    if (result.ok) {
      const codes = result.data.map((r) => r.currencyCode)
      expect(codes).toEqual(['EUR', 'USD'])
    }
  })
})

describe('refreshExchangeRates', () => {
  it('calls the external refresh and returns current rows from DB', async () => {
    mockedRefresh.mockImplementationOnce(async () => {
      // simulate that refreshRates upserted some rows
      await db
        .insert(exchangeRates)
        .values([
          { currencyCode: 'USD', rate: '1.10' },
          { currencyCode: 'CHF', rate: '0.95' },
        ])
    })

    const result = await refreshExchangeRates()
    expect(mockedRefresh).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const codes = result.data.map((r) => r.currencyCode).sort()
      expect(codes).toEqual(['CHF', 'USD'])
    }
  })
})
