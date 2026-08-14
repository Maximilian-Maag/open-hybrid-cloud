import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Role } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { CiSourcesManager } from './CiSourcesManager'
import { t } from '@/lib/i18n'
import { getLang } from '@/lib/getLang'

export default async function CiSourcesPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')
  const token = (session as unknown as { apiToken: string }).apiToken

  const lang = await getLang()

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader title={t('ciSources', lang)} subtitle={t('ciSourcesSubtitle', lang)} />
      <CiSourcesManager token={token} />
    </div>
  )
}
