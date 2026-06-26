import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Role } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { AuditTable } from './AuditTable'

export default async function AuditPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'admin' && role !== 'root') redirect('/')

  const token = (session as unknown as { apiToken: string }).apiToken

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader title="Audit Log" subtitle="Track all actions and changes in the system." />
      <AuditTable token={token} />
    </div>
  )
}
