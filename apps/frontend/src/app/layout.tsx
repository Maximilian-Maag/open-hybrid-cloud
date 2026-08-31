import type { Metadata } from 'next'
import { SessionProvider } from 'next-auth/react'
import { ToastProvider } from '@/components/ui/Toast'
import { HydrationMarker } from '@/components/system/HydrationMarker'
import { getLang } from '@/lib/getLang'
import './globals.css'

export const metadata: Metadata = {
  title: 'Open Hybrid Cloud',
  description: 'Self-service IT infrastructure portal',
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
          <HydrationMarker />
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
