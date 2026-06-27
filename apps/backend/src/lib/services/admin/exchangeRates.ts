import { db } from '@/lib/db/client'
import { exchangeRates, type ExchangeRate } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { refreshRates } from '@/lib/exchange'
import { ok, type Result } from '@/lib/services/result'

export const getExchangeRates = async (): Promise<Result<ExchangeRate[]>> => {
  const rows = await db
    .select()
    .from(exchangeRates)
    .orderBy(sql`${exchangeRates.currencyCode} ASC`)

  return ok(rows)
}

export const refreshExchangeRates = async (): Promise<Result<ExchangeRate[]>> => {
  await refreshRates()

  const rows = await db
    .select()
    .from(exchangeRates)
    .orderBy(sql`${exchangeRates.currencyCode} ASC`)

  return ok(rows)
}
