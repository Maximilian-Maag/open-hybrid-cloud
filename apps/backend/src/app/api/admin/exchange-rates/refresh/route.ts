import { NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { exchangeRates } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { refreshRates } from '@/lib/exchange'

export async function POST(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  await refreshRates()

  const rows = await db
    .select()
    .from(exchangeRates)
    .orderBy(sql`${exchangeRates.currencyCode} ASC`)

  return NextResponse.json(rows)
}
