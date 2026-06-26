import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { get } from '@/lib/api'
import type { Branding, Role } from '@open-hybrid-cloud/types'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const role = (session.user as unknown as { role: Role }).role

  let shopName = 'Open Hybrid Cloud'
  try {
    const branding = await get<Branding>('/api/admin/branding', token)
    if (branding?.shopName) shopName = branding.shopName
  } catch {
    // branding fetch failure is non-fatal
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar role={role} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header userName={session.user?.name} shopName={shopName} />
        <main className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {children}
        </main>
      </div>
    </div>
  )
}
