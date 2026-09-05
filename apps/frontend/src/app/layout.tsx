import type { Metadata, Viewport } from 'next'
import { SessionProvider } from 'next-auth/react'
import { ToastProvider } from '@/components/ui/Toast'
import { HydrationMarker } from '@/components/system/HydrationMarker'
import { ServiceWorker } from '@/components/system/ServiceWorker'
import { getLang } from '@/lib/getLang'
import { readBranding } from '@/lib/pwaBranding'
import './globals.css'

/**
 * Static metadata only.
 *
 * The title stays a constant on purpose: `generateMetadata` would make every
 * page in the app wait on a branding fetch before its first byte, to change a
 * string most users never look at. The manifest carries the operator's name to
 * the places that matter — the install prompt and the home screen — and it is
 * fetched once, out of band.
 */
export const metadata: Metadata = {
  title: 'Open Hybrid Cloud',
  description: 'Self-service IT infrastructure portal',
  // Generated per request from the `branding` row; see app/manifest.ts.
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    // Safari does not read the manifest. Without these three an install on iOS
    // opens in a browser tab with its chrome, which is the whole thing #148 is
    // asking for the absence of.
    capable: true,
    title: 'Open Hybrid Cloud',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    // iOS ignores `purpose: maskable` and crops to its own shape, so it gets
    // the inset variant — the plain one would lose its corners.
    apple: [{ url: '/icon-maskable.svg', type: 'image/svg+xml' }],
  },
}

/**
 * The colour behind the browser chrome, from the operator's branding.
 *
 * Separate from `metadata` because Next requires it to be: `themeColor` moved
 * out of the metadata export, and a `viewport` export may be async, which is
 * what lets this read the branding row at all.
 */
export async function generateViewport(): Promise<Viewport> {
  const branding = await readBranding()
  return {
    themeColor: branding.primaryColor,
    // The installed app draws under the status bar on notched devices; without
    // this the safe-area insets the layout relies on are never applied.
    viewportFit: 'cover',
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Reflect the selected language so assistive tech announces content in the
  // right language instead of always English.
  const lang = await getLang()
  return (
    <html lang={lang}>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
          {/* After the children, deliberately: see HydrationMarker. */}
          <HydrationMarker />
          <ServiceWorker />
        </SessionProvider>
      </body>
    </html>
  )
}
