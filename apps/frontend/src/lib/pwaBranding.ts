/**
 * The branding an installed app shows, read once per request.
 *
 * The manifest and the icons cannot be static files: shop name, subtitle, both
 * brand colours and the logo all live in the `branding` table and an operator
 * edits them (#148). A `public/manifest.json` would show the wrong operator's
 * name on every deployment but the one it was written for.
 *
 * Read from the PUBLIC branding endpoint, not the admin one: a manifest is
 * fetched by the browser before anyone signs in — often with no credentials at
 * all — so anything it depends on has to be reachable unauthenticated. That
 * endpoint already exists and the login page already uses it.
 */
const API_SSR = process.env.API_URL ?? 'http://localhost:3001'

export interface PwaBranding {
  shopName: string
  shopSubtitle: string
  primaryColor: string
  secondaryColor: string
  logoMime: string | null
}

/** What the app is called and coloured when branding cannot be read. */
export const FALLBACK: PwaBranding = {
  shopName: 'Open Hybrid Cloud',
  shopSubtitle: 'Self-Service Portal',
  // The same pair `bootstrap/index.ts` seeds, so an unbranded install and a
  // freshly bootstrapped one look alike rather than subtly different.
  primaryColor: '#131921',
  secondaryColor: '#febd69',
  logoMime: null,
}

export const readBranding = async (): Promise<PwaBranding> => {
  try {
    const res = await fetch(`${API_SSR}/api/public/branding`, { cache: 'no-store' })
    if (!res.ok) return FALLBACK
    const b = (await res.json()) as Partial<PwaBranding>
    return {
      shopName: b.shopName?.trim() || FALLBACK.shopName,
      shopSubtitle: b.shopSubtitle?.trim() || FALLBACK.shopSubtitle,
      primaryColor: b.primaryColor || FALLBACK.primaryColor,
      secondaryColor: b.secondaryColor || FALLBACK.secondaryColor,
      logoMime: b.logoMime ?? null,
    }
  } catch {
    // A manifest that 500s makes the app uninstallable; a manifest with the
    // default name does not. Falling back is the lesser failure.
    return FALLBACK
  }
}

/**
 * The operator's logo as a data URI, or null.
 *
 * Inlined rather than referenced so the icon is ONE request that cannot half
 * fail, and so the SVG stays self-contained when a browser rasterises it into
 * a launcher icon.
 */
export const readLogoDataUri = async (mime: string | null): Promise<string | null> => {
  if (!mime) return null
  try {
    const res = await fetch(`${API_SSR}/api/admin/branding/logo`, { cache: 'no-store' })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0) return null
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** `Open Hybrid Cloud` -> `OH`. What the icon shows when there is no logo. */
export const initialsOf = (name: string): string => {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]
  return letters.toUpperCase()
}

/** XML-escape, because the shop name is operator text going into an SVG. */
export const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
