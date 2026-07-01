import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Role, Branding } from '@open-hybrid-cloud/types'
import { get } from '@/lib/api'
import { PageHeader } from '@/components/layout/PageHeader'
import { BrandingForm } from './BrandingForm'

export default async function BrandingPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')
  const token = (session as unknown as { apiToken: string }).apiToken

  let branding: Branding = {
    primaryColor: '#1e40af',
    secondaryColor: '#3b82f6',
    shopName: 'Open Hybrid Cloud',
    shopSubtitle: '',
    imprintText: '',
  }

  try {
    branding = await get<Branding>('/api/admin/branding', token)
  } catch { /* use defaults */ }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader title="Branding" subtitle="Customize the portal appearance." />
      <BrandingForm initial={branding} token={token} />
    </div>
  )
}
