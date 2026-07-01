import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Role } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { CostCentersManager } from './CostCentersManager'

export default async function CostCentersPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')
  const token = (session as unknown as { apiToken: string }).apiToken

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader title="Cost Centers" subtitle="Manage cost center assignments." />
      <CostCentersManager token={token} />
    </div>
  )
}
