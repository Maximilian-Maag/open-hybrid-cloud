/**
 * Whether the portal may speak to a CI system over an unencrypted connection.
 *
 * Every outbound call in `gitlab.ts` carries a credential: the trigger token on
 * a pipeline trigger, `PRIVATE-TOKEN` on every list, branch, tree and file read.
 * `validateWebUrl` used to reject `file:` and `gopher:` and then permit plaintext
 * `http:` to any host on the internet, which put all of that on the wire in
 * clear (#329).
 *
 * GitLab is the only provider this can reach: `github.ts` and `bitbucket.ts`
 * hardcode `api.github.com` and `api.bitbucket.org` and ignore the configured
 * URL entirely — their `_apiUrl` parameters are unused.
 */

/**
 * Loopback, by the names a host is actually reached on.
 *
 * `.localhost` is loopback by RFC 6761, and `URL.hostname` hands back the IPv6
 * form still bracketed — `new URL('http://[::1]:8080').hostname` is `'[::1]'`.
 * The whole of 127.0.0.0/8 counts, not just 127.0.0.1.
 */
export const isLoopback = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '::1' ||
  hostname === '[::1]' ||
  /^127\.\d+\.\d+\.\d+$/.test(hostname)

/** Set to `1` to permit plaintext http to a non-loopback CI host. */
export const INSECURE_TRANSPORT_FLAG = 'ALLOW_INSECURE_CI_TRANSPORT'

/** Whether a URL may be used for an outbound CI call, and why not when it may not. */
export const insecureTransportRefusal = (url: string): string | null => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return `Not a URL: ${url}`
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return `Disallowed URL protocol: ${parsed.protocol}`
  }
  if (parsed.protocol !== 'http:' || isLoopback(parsed.hostname)) return null
  if (process.env[INSECURE_TRANSPORT_FLAG] === '1') return null

  return (
    `Refusing to send CI credentials over plaintext http to ${parsed.hostname}. ` +
    `Use https, or set ${INSECURE_TRANSPORT_FLAG}=1 if this host is genuinely reachable ` +
    'only over http and the network between is trusted.'
  )
}
