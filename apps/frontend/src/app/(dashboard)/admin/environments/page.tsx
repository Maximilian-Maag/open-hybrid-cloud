import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Role, CiSource } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { EnvironmentsManager } from './EnvironmentsManager'
import { get } from '@/lib/api'
import { t } from '@/lib/i18n'
import { getLang } from '@/lib/getLang'

export default async function EnvironmentsPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')
  const token = (session as unknown as { apiToken: string }).apiToken

  let ciSources: CiSource[] = []
  try {
    ciSources = (await get<CiSource[]>('/api/admin/ci-sources', token)) ?? []
  } catch { /* empty */ }

  const lang = await getLang()

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader title={t('environments', lang)} subtitle={t('environmentsSubtitle', lang)} />
      <EnvironmentsManager token={token} ciSources={ciSources} />
    </div>
  )
}
