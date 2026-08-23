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
  // undefined, not [], when the fetch fails. An empty array is indistinguishable
  // from "you have no other sessions", which for a security card is the worst
  // possible lie: it says the account is quiet while the endpoint is down, and
  // it also stops the client component from retrying. Leaving it undefined makes
  // ActiveSessions fetch on mount and surface its own error, while the rest of
  // the settings page still renders.
  let sessions: SessionInfo[] | undefined
  try {
    sessions = await get<SessionInfo[]>('/api/sessions', token)
  } catch { /* fall through with undefined */ }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader title={t('profileSettings', lang)} subtitle={t('profileSettingsSubtitle', lang)} />
      <SettingsForms token={token} initialName={userName} email={userEmail} />
      <ActiveSessions token={token} initialSessions={sessions} />
    </div>
  )
}
