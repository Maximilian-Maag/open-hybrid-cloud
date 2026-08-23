import type { Branding } from '@open-hybrid-cloud/types'

/**
 * Branding for the PWA surfaces: the manifest, the icons and `theme-color`.
 *
 * Deliberately the **public**, unauthenticated endpoint rather than
 * `/api/admin/branding`, which the dashboard layout uses with a bearer token.
 * A browser fetches a manifest with `credentials: 'omit'` unless the manifest
 * link opts in, and the OS re-fetches the icons at install time outside any
 * session at all — so everything the manifest chain depends on has to be
 * readable without a token, or an install silently falls back to defaults.
 */
const API_SSR = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? ''

/** Mirrors the shipped defaults in the backend's branding service. */
export const BRANDING_DEFAULTS = {
  primaryColor: '#131921',
  secondaryColor: '#febd69',
  shopName: 'Open Hybrid Cloud',
  shopSubtitle: '',
} as const

export type PwaBranding = {
  primaryColor: string
  secondaryColor: string
  shopName: string
  shopSubtitle: string
  logoMime: string | null
}

const DEFAULT_BRANDING: PwaBranding = { ...BRANDING_DEFAULTS, logoMime: null }

const asColor = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value.trim())
    ? value.trim()
    : fallback

const asText = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback

/**
 * The branding row, or the shipped defaults when the backend cannot be reached.
 *
 * Never throws, and never returns a partially valid row. A manifest that 500s
 * makes the app uninstallable and browsers remember that failure, so an
 * unreachable API has to degrade to a *valid* manifest in default colours
 * rather than to no manifest. The colour guard matters for the same reason:
 * `theme_color` is operator-typed, and a manifest with a malformed colour is
 * rejected wholesale by Chrome.
 */
export const getPwaBranding = async (): Promise<PwaBranding> => {
  try {
    const res = await fetch(`${API_SSR}/api/public/branding`, { cache: 'no-store' })
    if (!res.ok) return DEFAULT_BRANDING
    const body: unknown = await res.json()
    const row = (body ?? {}) as Partial<Branding>
    return {
      primaryColor: asColor(row.primaryColor, BRANDING_DEFAULTS.primaryColor),
      secondaryColor: asColor(row.secondaryColor, BRANDING_DEFAULTS.secondaryColor),
      shopName: asText(row.shopName, BRANDING_DEFAULTS.shopName),
      shopSubtitle: asText(row.shopSubtitle, ''),
      logoMime: typeof row.logoMime === 'string' && row.logoMime ? row.logoMime : null,
    }
  } catch {
    return DEFAULT_BRANDING
  }
}

/**
 * The operator's logo as a data URI, or null when there is none to be had.
 *
 * `next/og` rasterises from an element tree and satori resolves an `<img src>`
 * itself, so handing it a data URI keeps that resolution in-process instead of
 * making the renderer issue its own HTTP request back into our own stack.
 */
export const getLogoDataUrl = async (mime: string | null): Promise<string | null> => {
  if (!mime) return null
  try {
    const res = await fetch(`${API_SSR}/api/admin/branding/logo`, { cache: 'no-store' })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0) return null
    return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`
  } catch {
    return null
  }
}
