import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Role } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { UsersManager } from './UsersManager'
import { t } from '@/lib/i18n'
import { getLang } from '@/lib/getLang'

export default async function UsersPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')

  const lang = await getLang()

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader title={t('users', lang)} subtitle={t('usersSubtitle', lang)} />
      <UsersManager />
    </div>
  )
}
