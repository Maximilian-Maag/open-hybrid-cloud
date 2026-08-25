/**
 * Where this portal says it is, for WebAuthn (issue #197).
 *
 * An assertion is signed over the origin the browser was actually on and the
 * Relying Party ID it was scoped to, and the server checks both. That check is
 * the entire reason WebAuthn resists phishing — and it is also why this is the
 * one part of the feature that cannot be got right by accident:
 *
 *   * `WEBAUTHN_RP_ID` is a DOMAIN, never a URL and never a port. `portal.example.com`,
 *     or `example.com` to let credentials work across subdomains. It must equal
 *     the page's domain or be a registrable suffix of it, or the browser refuses
 *     to run the ceremony at all.
 *   * `WEBAUTHN_RP_ORIGIN` is a full origin WITH scheme and port —
 *     `https://portal.example.com`. It must be exactly what the browser sends,
 *     and a mismatch fails at verification rather than at startup.
 *
 * Get either wrong and every sign-in with a key fails on the deployed instance
 * while working perfectly on localhost, which is precisely the shape of #196.
 * So: both are required in production and validated here, at first use, with a
 * message that says what to set rather than a stack trace from inside the
 * library.
 *
 * Several origins are allowed, comma-separated, because one deployment can be
 * reachable as both `portal.example.com` and an internal hostname; the RP ID
 * still has to be a suffix of all of them.
 */

/** Localhost only, so a fresh clone runs `make dev` and keys work with no setup. */
const DEV_RP_ID = 'localhost'
const DEV_RP_ORIGINS = ['http://localhost:3000', 'http://localhost:3001']

export interface WebAuthnRp {
  rpId: string
  origins: string[]
  /** What the authenticator shows the user. The shop name, not a hostname. */
  rpName: string
}

const isProduction = (): boolean => process.env.NODE_ENV === 'production'

/**
 * A hostname, not a URL — the mistake this catches is `https://portal.example.com`
 * pasted into RP_ID, which the browser rejects with a message that names neither
 * the variable nor the file.
 */
const looksLikeDomain = (value: string): boolean =>
  value.length > 0 && !value.includes('/') && !value.includes(':') && !value.includes(' ')

const parseOrigins = (raw: string): string[] =>
  raw
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter((o) => o !== '')

export const resolveRp = (rpName: string): WebAuthnRp => {
  const rawId = (process.env.WEBAUTHN_RP_ID ?? '').trim()
  const rawOrigins = (process.env.WEBAUTHN_RP_ORIGIN ?? '').trim()

  if (rawId === '' || rawOrigins === '') {
    if (isProduction()) {
      throw new Error(
        'WEBAUTHN_RP_ID and WEBAUTHN_RP_ORIGIN must be set in production. ' +
          'RP_ID is the domain alone (portal.example.com); RP_ORIGIN is the full origin ' +
          'the browser sees, with scheme and port (https://portal.example.com). ' +
          'See the WebAuthn section of README.md.',
      )
    }
    return { rpId: DEV_RP_ID, origins: DEV_RP_ORIGINS, rpName }
  }

  if (!looksLikeDomain(rawId)) {
    throw new Error(
      `WEBAUTHN_RP_ID must be a bare domain, not "${rawId}". No scheme, no port, no path — ` +
        'use portal.example.com, not https://portal.example.com:443.',
    )
  }

  const origins = parseOrigins(rawOrigins)
  if (origins.length === 0) {
    throw new Error('WEBAUTHN_RP_ORIGIN is set but contains no usable origin.')
  }

  for (const origin of origins) {
    let host: string
    try {
      host = new URL(origin).hostname
    } catch {
      throw new Error(
        `WEBAUTHN_RP_ORIGIN entry "${origin}" is not a URL. Include the scheme: https://portal.example.com.`,
      )
    }
    // The browser enforces this too, by refusing the ceremony. Failing here
    // instead means the operator is told which variable is wrong, once, rather
    // than every user seeing a key that silently never works.
    if (host !== rawId && !host.endsWith(`.${rawId}`)) {
      throw new Error(
        `WEBAUTHN_RP_ORIGIN entry "${origin}" has host "${host}", which is not ` +
          `"${rawId}" or a subdomain of it. A credential scoped to an RP ID the page ` +
          'does not belong to can never be used.',
      )
    }
  }

  return { rpId: rawId, origins, rpName }
}
