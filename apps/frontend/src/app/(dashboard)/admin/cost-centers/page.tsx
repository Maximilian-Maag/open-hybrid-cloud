import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Role } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { CostCentersManager } from './CostCentersManager'
import { t } from '@/lib/i18n'
import { getLang } from '@/lib/getLang'

export default async function CostCentersPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')
  const token = (session as unknown as { apiToken: string }).apiToken

  const lang = await getLang()

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader title={t('costCenters', lang)} subtitle={t('costCentersSubtitle', lang)} />
      <CostCentersManager token={token} />
    </div>
  )
}
