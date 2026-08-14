import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { SettingsForms } from './SettingsForms'
import { t } from '@/lib/i18n'
import { getLang } from '@/lib/getLang'

export default async function SettingsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const userName = session.user?.name ?? ''
  const userEmail = session.user?.email ?? ''

  const lang = await getLang()

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader title={t('profileSettings', lang)} subtitle={t('profileSettingsSubtitle', lang)} />
      <SettingsForms token={token} initialName={userName} email={userEmail} />
    </div>
  )
}
