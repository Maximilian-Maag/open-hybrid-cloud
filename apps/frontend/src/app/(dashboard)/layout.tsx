import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { get } from '@/lib/api'
import type { Branding, Role } from '@open-hybrid-cloud/types'
import { t, isValidLang } from '@/lib/i18n'

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

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const role = (session.user as unknown as { role: Role }).role
  const lang = await detectLang()

  let shopName = 'Open Hybrid Cloud'
  let hasImprint = false
  try {
    const branding = await get<Branding>('/api/admin/branding', token)
    if (branding?.shopName) shopName = branding.shopName
    hasImprint = !!branding?.imprintText
  } catch {
    // branding fetch failure is non-fatal
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar role={role} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header userName={session.user?.name} shopName={shopName} lang={lang} signOutLabel={t('signOut', lang)} />
        <main className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {children}
        </main>
        {hasImprint && (
          <footer className="border-t border-slate-200 bg-white px-6 py-2 text-xs text-slate-400 flex justify-end">
            <Link href="/impressum" className="hover:text-slate-600 hover:underline">Imprint</Link>
          </footer>
        )}
      </div>
    </div>
  )
}
