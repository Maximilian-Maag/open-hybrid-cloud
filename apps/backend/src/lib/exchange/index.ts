import { db } from '@/lib/db/client'
import { exchangeRates } from '@/lib/db/schema'

interface ExchangeRateApiResponse {
  rates: Record<string, number>
  base?: string
  success?: boolean
}

export const refreshRates = async (): Promise<void> => {
  const apiUrl =
    process.env.EXCHANGE_RATE_API_URL ?? 'https://api.exchangerate.host/latest'

  const res = await fetch(apiUrl)
  if (!res.ok) throw new Error(`Exchange rate fetch failed: ${res.status}`)

  const data = await res.json() as ExchangeRateApiResponse
  const rates = data.rates

  if (!rates || typeof rates !== 'object') {
    throw new Error('Invalid exchange rate API response')
  }

  const now = new Date()

  for (const [currencyCode, rate] of Object.entries(rates)) {
    await db
      .insert(exchangeRates)
      .values({ currencyCode, rate: String(rate), updatedAt: now })
      .onConflictDoUpdate({
        target: exchangeRates.currencyCode,
        set: { rate: String(rate), updatedAt: now },
      })
  }
}

export const convertAmount = (
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number => {
  if (from === to) return amount

  const fromRate = rates[from]
  const toRate = rates[to]

  if (!fromRate || !toRate) {
    throw new Error(`Exchange rate not found for ${from} or ${to}`)
  }

  // Convert to base then to target
  return (amount / fromRate) * toRate
}
