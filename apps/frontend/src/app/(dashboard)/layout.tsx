import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { Header } from '@/components/layout/Header'
import { TopNav } from '@/components/layout/TopNav'
import type { Branding } from '@open-hybrid-cloud/types'
import { getLang } from '@/lib/getLang'

const API_SSR = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? ''

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  // THIS IS THE CRITICAL FIX:
  // Validate the session and all its required properties safely.
  // If anything is missing, the session is invalid; redirect to login.
  if (!session || !session.user || !session.apiToken || !session.user.role) {
    redirect('/login')
  }

  const token = session.apiToken
  const role = session.user.role
  const lang = await getLang()

  let branding: Branding = {
    primaryColor: '#131921',
    secondaryColor: '#febd69',
    shopName: 'Open Hybrid Cloud',
    shopSubtitle: '',
    imprintText: '',
  }
  try {
    const res = await fetch(`${API_SSR}/api/admin/branding`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (res.ok) branding = await res.json()
  } catch { /* use defaults */ }

  let logoDataUrl: string | null = null
  if (branding.logoMime) {
    try {
      const res = await fetch(`${API_SSR}/api/admin/branding/logo`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (res.ok) {
        const buf = await res.arrayBuffer()
        logoDataUrl = `data:${branding.logoMime};base64,${Buffer.from(buf).toString('base64')}`
      }
    } catch { /* non-fatal */ }
  }

  const {
    primaryColor = '#131921',
    secondaryColor = '#febd69',
    shopName = 'Open Hybrid Cloud',
    shopSubtitle = '',
    imprintText = '',
  } = branding

  return (
    <div
      className="min-h-screen flex flex-col bg-slate-50 text-slate-900 antialiased"
      style={{ '--bp': primaryColor, '--bs': secondaryColor } as React.CSSProperties}
    >
      <Header
        userName={session.user?.name}
        shopName={shopName}
        logoDataUrl={logoDataUrl}
        lang={lang}
      />
      <TopNav role={role} />
      <main className="flex-1">
        <div className="max-w-screen-2xl mx-auto px-4 py-6 animate-page-in">
          {children}
        </div>
      </main>
      {imprintText && (
        <footer className="mt-10 border-t border-white/10" style={{ backgroundColor: 'var(--bp)' }}>
          <div className="max-w-screen-2xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span className="text-white/50 text-xs">
              © {shopName}{shopSubtitle ? ` — ${shopSubtitle}` : ''}
            </span>
            <div className="flex gap-4">
              <Link href="/catalog" className="text-white/60 text-xs hover:text-white transition-colors">Catalog</Link>
              <Link href="/orders" className="text-white/60 text-xs hover:text-white transition-colors">Orders</Link>
              <Link href="/impressum" className="text-white/60 text-xs hover:text-white transition-colors">Imprint</Link>
            </div>
          </div>
        </footer>
      )}
    </div>
  )
}
