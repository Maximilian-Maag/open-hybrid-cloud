/**
 * The per-size values of a `size` parameter, as an admin edits them.
 *
 * Stored as a map — `{ "S": "t3.micro", "XL": "m6i.2xlarge" }` — and edited as
 * one `CODE=value` per line. A text area rather than a row of fields because
 * the codes belong to an offering, not to the parameter: a product-scoped
 * variable can be driven by sizes from several offerings, so there is no fixed
 * set of inputs to render. It also survives pasting a table out of a template's
 * README, which is where these values usually come from.
 */

/** Map to text, in a stable order so an edit does not reshuffle the box. */
export const sizeValuesToText = (values: Record<string, string> | undefined): string =>
  Object.entries(values ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, value]) => `${code}=${value}`)
    .join('\n')

/**
 * Text back to a map.
 *
 * Only the FIRST `=` splits, so a value may contain one — `user_data=KEY=VALUE`
 * is a real thing to want. Blank lines and lines with no `=` are dropped rather
 * than rejected: this runs on every keystroke, and refusing half-typed input
 * would fight the person typing it. The server validates what is submitted.
 */
export const parseSizeValues = (text: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at <= 0) continue
    const code = line.slice(0, at).trim()
    if (code === '') continue
    out[code] = line.slice(at + 1).trim()
  }
  return out
}
