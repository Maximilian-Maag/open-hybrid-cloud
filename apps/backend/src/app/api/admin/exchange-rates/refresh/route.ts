import { type NextRequest } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { refreshExchangeRates } from '@/lib/services/admin/exchangeRates'

export async function POST(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  return toResponse(await refreshExchangeRates())
}
