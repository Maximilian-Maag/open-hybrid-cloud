import type { ReactElement } from 'react'
import { readableInk } from '@/lib/contrast'

/**
 * The PWA icon set, rendered on demand from the branding row.
 *
 * ## Why they are generated, not stored
 *
 * The logo is a single `bytea` of whatever size and type the operator uploaded,
 * served by `/api/admin/branding/logo`. A manifest needs *fixed* sizes (Chrome's
 * installability check wants at least 192 and 512), iOS needs a raster
 * `apple-touch-icon`, and a maskable icon needs padding the operator's file does
 * not have. So the icons cannot be the logo passed through.
 *
 * The two ways to get fixed sizes are resizing the upload or rendering the icon.
 * Resizing means a new native dependency (`sharp`) and a migration to backfill
 * variants for logos already in the table. Rendering means `next/og`'s
 * `ImageResponse`, which **ships inside `next`** — no new dependency at all —
 * and composes the icon rather than merely scaling it: the brand colour as the
 * ground, the logo centred inside the maskable safe zone, and a legible
 * monogram when there is no logo at all. That is the option taken here.
 *
 * ## Safe zones
 *
 * A maskable icon may be cropped to a circle of 80 % diameter, so its content
 * has to sit inside roughly the central 60 % to survive every mask a launcher
 * might apply. A plain (`purpose: "any"`) icon is shown as-is and can use more
 * of the square. `apple-touch-icon` is not a maskable icon in the spec sense,
 * but iOS rounds its corners hard, so it gets the same treatment.
 */

export type IconSpec = {
  /** Rendered edge length in CSS pixels; the PNG is square. */
  size: number
  /** `maskable` icons keep their content inside the launcher-safe circle. */
  purpose: 'any' | 'maskable'
  /** Whether this file is advertised in the manifest's `icons` array. */
  inManifest: boolean
}

export const ICON_SPECS: Record<string, IconSpec> = {
  '192.png': { size: 192, purpose: 'any', inManifest: true },
  '512.png': { size: 512, purpose: 'any', inManifest: true },
  'maskable-192.png': { size: 192, purpose: 'maskable', inManifest: true },
  'maskable-512.png': { size: 512, purpose: 'maskable', inManifest: true },
  // Safari still reads this from a <link>, not from the manifest.
  'apple-touch-icon.png': { size: 180, purpose: 'maskable', inManifest: false },
}

export const ICON_BASE = '/icons'

/** Fraction of the square the icon's content may occupy. */
const contentFraction = (purpose: IconSpec['purpose']): number =>
  purpose === 'maskable' ? 0.6 : 0.76

/**
 * Up to two initials for the shop name, used when no logo is configured.
 *
 * Falls back to `?` rather than an empty string: an icon with no content at all
 * reads as a broken download instead of a deliberate placeholder.
 */
export const monogram = (shopName: string): string => {
  const words = shopName
    .split(/[\s\-_/]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/**
 * MIME types satori can decode for an `<img src>`.
 *
 * Anything else (AVIF today, whatever tomorrow) falls through to the monogram
 * rather than to a blank square. The renderer is also wrapped in a try/catch at
 * the route, so this list being wrong degrades the icon instead of 500ing it.
 */
const RASTER_MIME = /^image\/(png|jpe?g|gif|svg\+xml)$/i

export const canRenderLogo = (mime: string | null): boolean =>
  !!mime && RASTER_MIME.test(mime.trim())

type IconInput = {
  spec: IconSpec
  primaryColor: string
  shopName: string
  logoDataUrl: string | null
}

/**
 * The element tree handed to `ImageResponse`.
 *
 * A plain function returning an element rather than a component: satori walks
 * the tree it is given, and keeping it out of the component namespace makes it
 * obvious this is never rendered by React.
 */
export const brandIconNode = ({ spec, primaryColor, shopName, logoDataUrl }: IconInput): ReactElement => {
  const { size, purpose } = spec
  const content = Math.round(size * contentFraction(purpose))
  // The same luminance-derived ink the chrome uses, so a mid-tone brand colour
  // does not produce an illegible monogram (see lib/contrast.ts).
  const ink = readableInk(primaryColor).ink

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primaryColor,
      }}
    >
      {logoDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
        <img src={logoDataUrl} width={content} height={content} style={{ objectFit: 'contain' }} />
      ) : (
        <div
          style={{
            display: 'flex',
            color: ink,
            // Two characters across the content box, with room for the taller
            // scripts among the 25 languages the portal ships.
            fontSize: Math.round(content * 0.62),
            fontWeight: 700,
            letterSpacing: -Math.round(size * 0.01),
          }}
        >
          {monogram(shopName)}
        </div>
      )}
    </div>
  )
}

/** The same square with no content — last resort if text or image rendering fails. */
export const plainIconNode = (primaryColor: string): ReactElement => (
  <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: primaryColor }} />
)
