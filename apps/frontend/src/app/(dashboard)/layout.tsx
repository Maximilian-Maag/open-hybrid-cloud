import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { Header } from '@/components/layout/Header'
import { TopNav } from '@/components/layout/TopNav'
import type { Branding, Role } from '@open-hybrid-cloud/types'
import { t, isValidLang } from '@/lib/i18n'

const API_SSR = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? ''

async function detectLang(): Promise<string> {
  const cookieStore = await cookies()
  const langCookie = cookieStore.get('lang')?.value
  if (langCookie && isValidLang(langCookie)) return langCookie

  const hdrs = await headers()
  const acceptLang = hdrs.get('accept-language') ?? ''
  const primary = acceptLang.split(',')[0]?.split(';')[0]?.trim() ?? 'en'
  const code = primary.split('-')[0].toLowerCase()
  if (isValidLang(code)) return code
  return 'en'
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const role = (session.user as unknown as { role: Role }).role
  const lang = await detectLang()

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
        signOutLabel={t('signOut', lang)}
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
              <Link href="/catalog" className="text-white/60 text-xs hover:text-white transition-colors">
                {t('catalog', lang)}
              </Link>
              <Link href="/orders" className="text-white/60 text-xs hover:text-white transition-colors">
                {t('orders', lang)}
              </Link>
              <Link href="/impressum" className="text-white/60 text-xs hover:text-white transition-colors">
                Imprint
              </Link>
            </div>
          </div>
        </footer>
      )}
    </div>
  )
}
