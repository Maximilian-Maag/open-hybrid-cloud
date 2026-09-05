import { NextResponse } from 'next/server'
import { readBranding, readLogoDataUri, initialsOf, xmlEscape } from '@/lib/pwaBranding'
import { readableInk } from '@/lib/contrast'

/**
 * The launcher icon, drawn from the operator's branding (#148).
 *
 * SVG, and generated rather than resized. A manifest wants several fixed pixel
 * sizes; the logo in the database is one raster of whatever size was uploaded,
 * and resizing it would mean an image library — `sharp` and its native build —
 * for one icon. An SVG declared `sizes: "any"` satisfies the installability
 * check and the browser rasterises it at whatever size it needs, which is
 * strictly better than us picking three.
 *
 * The logo is EMBEDDED as a data URI rather than referenced. One request that
 * cannot half-fail, and the rasteriser does not have to fetch anything.
 *
 * With no logo the icon is the shop's initials on the primary colour, in
 * whichever ink `readableInk` says is legible on it — the same function the
 * dashboard uses, so an operator with a pale brand gets dark text here too.
 */
export const dynamic = 'force-dynamic'

const SIZE = 512

/** Padding as a fraction of the canvas. */
const inset = (fraction: number) => Math.round(SIZE * fraction)

export const buildIcon = (
  { name, background, ink, logo, safeZone }:
  { name: string; background: string; ink: string; logo: string | null; safeZone: number },
): string => {
  const pad = inset(safeZone)
  const inner = SIZE - pad * 2
  const art = logo
    ? `<image href="${xmlEscape(logo)}" x="${pad}" y="${pad}" width="${inner}" height="${inner}" preserveAspectRatio="xMidYMid meet"/>`
    // `textLength` is not used: it distorts glyphs. The font size is derived
    // from the safe zone so two letters fit at either inset.
    : `<text x="${SIZE / 2}" y="${SIZE / 2}" fill="${ink}" font-family="system-ui, sans-serif"` +
      ` font-size="${Math.round(inner * 0.5)}" font-weight="700" text-anchor="middle"` +
      ` dominant-baseline="central">${xmlEscape(initialsOf(name))}</text>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img" aria-label="${xmlEscape(name)}">` +
    `<rect width="${SIZE}" height="${SIZE}" fill="${background}"/>${art}</svg>`
}

export async function GET() {
  const branding = await readBranding()
  const logo = await readLogoDataUri(branding.logoMime)

  const svg = buildIcon({
    name: branding.shopName,
    background: branding.primaryColor,
    ink: readableInk(branding.primaryColor).ink,
    logo,
    // A plain icon is drawn edge to edge; a small inset keeps a square logo off
    // the corners without looking cropped.
    safeZone: 0.12,
  })

  return new NextResponse(svg, {
    headers: {
      'content-type': 'image/svg+xml',
      // Short, because branding is editable and an operator who changes their
      // logo should not be told to clear their launcher.
      'cache-control': 'public, max-age=300, must-revalidate',
    },
  })
}
