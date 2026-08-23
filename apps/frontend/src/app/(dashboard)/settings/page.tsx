import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { SessionInfo } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SettingsForms } from './SettingsForms'
import { ActiveSessions } from '@/components/forms/ActiveSessions'
import { get } from '@/lib/api'
import { t } from '@/lib/i18n'
import { getLang } from '@/lib/getLang'

export default async function SettingsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const userName = session.user?.name ?? ''
  const userEmail = session.user?.email ?? ''

  const lang = await getLang()

  // Fetched here rather than in the client component so the first paint shows the
  // real list. Non-fatal on purpose: this page is also where you change your
  // password, and an outage on the session endpoint must not take that away. The
  // one 401 case that matters — the session ending mid-render — is already handled
  // upstream by the middleware and the dashboard layout (#103).
  let sessions: SessionInfo[] = []
  try {
    sessions = await get<SessionInfo[]>('/api/sessions', token)
  } catch { /* the card renders empty rather than the page failing */ }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader title={t('profileSettings', lang)} subtitle={t('profileSettingsSubtitle', lang)} />
      <SettingsForms token={token} initialName={userName} email={userEmail} />
      <ActiveSessions token={token} initialSessions={sessions} />
    </div>
  )
}
