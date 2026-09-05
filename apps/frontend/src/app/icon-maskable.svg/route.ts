import { NextResponse } from 'next/server'
import { readBranding, readLogoDataUri } from '@/lib/pwaBranding'
import { readableInk } from '@/lib/contrast'
import { buildIcon } from '../icon.svg/route'

/**
 * The same icon, drawn for a mask (#148).
 *
 * Android crops a maskable icon to whatever shape the launcher uses — circle,
 * squircle, teardrop — and only the middle 80% is guaranteed to survive. The
 * artwork is therefore inset further than the plain icon; the background still
 * covers the whole canvas, which is what stops a white corner appearing when
 * the launcher crops.
 *
 * A separate route rather than a query parameter so the manifest can name it
 * with `purpose: "maskable"` and a browser can cache the two independently.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const branding = await readBranding()
  const logo = await readLogoDataUri(branding.logoMime)

  const svg = buildIcon({
    name: branding.shopName,
    background: branding.primaryColor,
    ink: readableInk(branding.primaryColor).ink,
    logo,
    // 20% inset: the safe zone a maskable icon is specified against.
    safeZone: 0.2,
  })

  return new NextResponse(svg, {
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=300, must-revalidate',
    },
  })
}
