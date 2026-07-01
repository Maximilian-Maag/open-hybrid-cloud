import { NextResponse } from 'next/server'
import { getExchangeRates } from '@/lib/services/admin/exchangeRates'

export async function GET() {
  const result = await getExchangeRates()
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
  return NextResponse.json(result.data)
}
