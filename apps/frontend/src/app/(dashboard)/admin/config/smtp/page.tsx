import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Role, SmtpConfig } from '@open-hybrid-cloud/types'
import { get } from '@/lib/api'
import { PageHeader } from '@/components/layout/PageHeader'
import { SmtpForm } from './SmtpForm'

export default async function SmtpConfigPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')
  const token = (session as unknown as { apiToken: string }).apiToken

  let config: SmtpConfig | null = null
  try {
    config = await get<SmtpConfig>('/api/admin/config/smtp', token)
  } catch { /* use null */ }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader title="SMTP Configuration" subtitle="Configure email delivery settings." />
      <SmtpForm initial={config} token={token} />
    </div>
  )
}
