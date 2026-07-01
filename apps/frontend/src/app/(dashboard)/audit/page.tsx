import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Role } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { AuditTable } from './AuditTable'
import { getLang } from '@/lib/getLang'
import { t } from '@/lib/i18n'

export default async function AuditPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'admin' && role !== 'root') redirect('/')

  const token = (session as unknown as { apiToken: string }).apiToken
  const lang = await getLang()

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader title={t('auditLog', lang)} subtitle={t('auditSubtitle', lang)} />
      <AuditTable token={token} />
    </div>
  )
}
