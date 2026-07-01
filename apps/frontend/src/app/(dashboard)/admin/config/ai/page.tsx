import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Role, AiConfig } from '@open-hybrid-cloud/types'
import { get } from '@/lib/api'
import { PageHeader } from '@/components/layout/PageHeader'
import { AiConfigForm } from './AiConfigForm'

export default async function AiConfigPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const role = (session.user as unknown as { role: Role }).role
  if (role !== 'root') redirect('/admin')
  const token = (session as unknown as { apiToken: string }).apiToken

  let config: AiConfig | null = null
  try {
    config = await get<AiConfig>('/api/admin/config/ai', token)
  } catch { /* use null */ }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader title="AI Configuration" subtitle="Configure AI provider for automatic translations." />
      <AiConfigForm initial={config} token={token} />
    </div>
  )
}
