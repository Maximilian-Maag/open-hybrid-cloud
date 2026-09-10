import { db } from '@/lib/db/client'
import { exchangeRates, type ExchangeRate } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { refreshRates } from '@/lib/exchange'
import { ok, type Result } from '@/lib/services/result'
import { logAudit } from '@/lib/audit'

export const getExchangeRates = async (): Promise<Result<ExchangeRate[]>> => {
  const rows = await db
    .select()
    .from(exchangeRates)
    .orderBy(sql`${exchangeRates.currencyCode} ASC`)

  return ok(rows)
}

export const refreshExchangeRates = async (
  actorId?: number,
): Promise<Result<ExchangeRate[]>> => {
  await refreshRates()

  const rows = await db
    .select()
    .from(exchangeRates)
    .orderBy(sql`${exchangeRates.currencyCode} ASC`)

  // Rates decide what every order costs, so a manual refresh is a mutation worth
  // recording — the count, not the rates themselves, which the table already has.
  await logAudit(actorId ?? null, 'exchange_rate.refreshed', undefined, `${rows.length} rate(s) refreshed`)

  return ok(rows)
}
