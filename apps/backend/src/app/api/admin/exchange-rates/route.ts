import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { exchangeRates } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  const rows = await db
    .select()
    .from(exchangeRates)
    .orderBy(sql`${exchangeRates.currencyCode} ASC`)

  return NextResponse.json(rows)
}
