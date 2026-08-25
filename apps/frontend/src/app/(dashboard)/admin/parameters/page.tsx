import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Role } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { ParametersManager } from './ParametersManager'
import { t } from '@/lib/i18n'
import { getLang } from '@/lib/getLang'

export default async function ParametersPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')

  const lang = await getLang()

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader title={t('globalParameters', lang)} subtitle={t('globalParametersSubtitle', lang)} />
      <ParametersManager />
    </div>
  )
}
