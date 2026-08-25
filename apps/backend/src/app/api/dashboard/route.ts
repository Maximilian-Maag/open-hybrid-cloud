import { type NextRequest } from 'next/server'
import { requireAuth, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { getDashboardSummary } from '@/lib/services/dashboard'

/**
 * The landing page's four counters and its five most recent orders (#158).
 *
 * Exists so the dashboard stops answering "how many orders do I have" by
 * downloading every order. `requireAuth` and nothing more: every field is
 * scoped to what the caller could already read from the three list endpoints
 * this replaces, so it grants no new visibility.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (!isAuth(session)) return session

  // Same `?lang=` the other product-name readers take; swaps to the shared
  // `requestLang` helper when #162 lands it.
  const lang = new URL(req.url).searchParams.get('lang') ?? 'en'
  return toResponse(await getDashboardSummary(session, lang))
}
