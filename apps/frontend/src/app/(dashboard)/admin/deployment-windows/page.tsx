import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Role } from '@infrashelf/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { DeploymentWindowsManager } from './DeploymentWindowsManager'
import { HolidaysManager } from './HolidaysManager'
import { t } from '@/lib/i18n'
import { getLang } from '@/lib/getLang'

export default async function DeploymentWindowsPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')

  const lang = await getLang()

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader title={t('deploymentWindows', lang)} subtitle={t('deploymentWindowsSubtitle', lang)} />
      <DeploymentWindowsManager />
      {/* Same page, because they are one policy: the windows say when, the
          holidays say which days are excluded from it entirely. */}
      <HolidaysManager />
    </div>
  )
}
