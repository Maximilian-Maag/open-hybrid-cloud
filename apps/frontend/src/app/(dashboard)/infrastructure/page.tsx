import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { redirect } from 'next/navigation'
import type { InfrastructureElement } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { InfraActions } from './InfraActions'

export default async function InfrastructurePage() {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken

  let elements: InfrastructureElement[] = []
  try {
    elements = (await get<InfrastructureElement[]>('/api/infrastructure', token)) ?? []
  } catch {
    /* empty */
  }

  // Group by project
  const byProject: Record<string, InfrastructureElement[]> = {}
  for (const el of elements) {
    const key = el.projectName ?? `Project #${el.projectId}`
    if (!byProject[key]) byProject[key] = []
    byProject[key].push(el)
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Infrastructure"
        subtitle="Deployed infrastructure elements grouped by project."
      />

      {elements.length === 0 ? (
        <div className="text-center py-12 text-slate-400">No infrastructure elements yet.</div>
      ) : (
        Object.entries(byProject).map(([projectName, items]) => (
          <Card key={projectName} title={projectName}>
            <div className="space-y-3">
              {items.map((item) => (
                <InfraRow key={item.id} item={item} token={token} />
              ))}
            </div>
          </Card>
        ))
      )}
    </div>
  )
}

function InfraRow({ item, token }: { item: InfrastructureElement; token: string }) {
  const outputs = Object.entries(item.outputs ?? {})
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <span className="font-medium text-slate-900">
              {item.productName ?? `Product #${item.productId}`}
            </span>
            <StatusBadge status={item.status} />
          </div>
          <p className="text-xs text-slate-500">
            {item.environmentName} ·{' '}
            {item.deployedAt ? new Date(item.deployedAt).toLocaleString() : 'Not deployed'}
          </p>
          {outputs.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-blue-600 hover:text-blue-700 select-none">
                {outputs.length} output{outputs.length !== 1 ? 's' : ''}
              </summary>
              <div className="mt-2 rounded bg-slate-50 p-2 space-y-1">
                {outputs.map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-xs">
                    <span className="font-mono text-slate-500 min-w-24">{k}:</span>
                    <span className="font-mono text-slate-900 break-all">{v}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
        <InfraActions item={item} token={token} />
      </div>
    </div>
  )
}
