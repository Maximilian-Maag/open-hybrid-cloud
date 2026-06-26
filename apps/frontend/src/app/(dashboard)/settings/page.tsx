import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { SettingsForms } from './SettingsForms'

export default async function SettingsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const userName = session.user?.name ?? ''
  const userEmail = session.user?.email ?? ''

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader title="Profile Settings" subtitle="Update your name and password." />
      <SettingsForms token={token} initialName={userName} email={userEmail} />
    </div>
  )
}
