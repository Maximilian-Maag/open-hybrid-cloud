import type { MetadataRoute } from 'next'
import { readBranding, shortNameFor } from '@/lib/pwaBranding'

/**
 * The web app manifest, generated per request (#148).
 *
 * It cannot be `public/manifest.json`. Shop name, subtitle and both brand
 * colours live in the `branding` table and an operator edits them, so a static
 * file would show the wrong operator's name on every deployment but the one it
 * was written for.
 *
 * `force-dynamic` for the same reason: Next would otherwise render this once at
 * build time, which is exactly the static file with extra steps.
 */
export const dynamic = 'force-dynamic'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await readBranding()

  return {
    name: branding.shopName,
    // Cut at a word boundary, not at character twelve — see `shortNameFor`. The
    // subtitle is not appended on purpose: "Open Hybrid Cloud Self-Service
    // Portal" under an icon is a name nobody can read.
    short_name: shortNameFor(branding.shopName),
    description: branding.shopSubtitle,
    start_url: '/',
    // The dashboard, not `/login`: an installed app that opens on a sign-in
    // page even when the session is good reads as broken. `/` redirects to
    // login when it has to.
    scope: '/',
    display: 'standalone',
    // The chrome around the app, and the colour behind it before the first
    // paint. Both from branding, so an installed app matches the portal it was
    // installed from.
    theme_color: branding.primaryColor,
    background_color: branding.primaryColor,
    orientation: 'any',
    icons: [
      {
        // SVG with `sizes: "any"`, which satisfies installability and lets the
        // browser rasterise at whatever size it needs. The alternative was
        // resizing the uploaded logo into three fixed PNGs, which means an
        // image library and a native build for one icon.
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        // Separate, because Android crops a maskable icon to the launcher's
        // shape and only the middle 80% survives — this one insets the artwork
        // to match, while the background still covers the whole canvas.
        src: '/icon-maskable.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  }
}
