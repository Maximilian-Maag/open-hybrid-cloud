import type { NextRequest } from 'next/server'

/**
 * Where a request appears to come from, and what appears to have made it.
 *
 * Both values are recorded on a session row (issue #37) so a user can recognise
 * their own devices in the list. Neither is ever trusted for a security decision:
 * they are labels for a human, not identity.
 */

/** Longest User-Agent we keep. Real ones are ~120 chars; the cap is for the rest. */
export const USER_AGENT_MAX_LENGTH = 400

/**
 * Client address, or null when there is no trustworthy one.
 *
 * `X-Forwarded-For` is attacker-controlled unless a reverse proxy we trust sets
 * it, so it is only read when the operator opts in via `TRUST_PROXY`. Returning
 * null rather than a guess matters twice over: the login rate limiter must not
 * bucket by a header the attacker chooses, and a session list must not show an
 * address the session did not come from.
 */
export const clientIp = (req: NextRequest): string | null => {
  const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true'
  if (!trustProxy) return null
  const xff = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
  return xff ? xff : null
}

/**
 * The User-Agent header, truncated, or null when absent or empty.
 *
 * Truncated because it is displayed: a client is free to send kilobytes, and
 * nothing about that belongs in a table cell or in the database.
 */
export const clientUserAgent = (req: NextRequest): string | null => {
  const ua = req.headers.get('user-agent')?.trim()
  if (!ua) return null
  return ua.length > USER_AGENT_MAX_LENGTH ? ua.slice(0, USER_AGENT_MAX_LENGTH) : ua
}
