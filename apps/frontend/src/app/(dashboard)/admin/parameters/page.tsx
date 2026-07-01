import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Role } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { ParametersManager } from './ParametersManager'

export default async function ParametersPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')
  const token = (session as unknown as { apiToken: string }).apiToken

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader title="Global Parameters" subtitle="Shared parameter definitions available across products." />
      <ParametersManager token={token} />
    </div>
  )
}
