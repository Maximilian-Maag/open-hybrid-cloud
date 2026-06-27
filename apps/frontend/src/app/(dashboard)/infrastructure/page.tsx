import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { InfrastructureElement } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { InfraActions } from './InfraActions'
import { t, isValidLang } from '@/lib/i18n'

async function detectLang(): Promise<string> {
  const cookieStore = await cookies()
  const langCookie = cookieStore.get('lang')?.value
  if (langCookie && isValidLang(langCookie)) return langCookie
  const hdrs = await headers()
  const acceptLang = hdrs.get('accept-language') ?? ''
  const code = acceptLang.split(',')[0]?.split(';')[0]?.trim().split('-')[0].toLowerCase() ?? 'en'
  if (isValidLang(code)) return code
  return 'en'
}

export default async function InfrastructurePage() {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const lang = await detectLang()

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
        title={t('infrastructureTitle', lang)}
        subtitle={t('infrastructureSubtitle', lang)}
      />

      {elements.length === 0 ? (
        <div className="text-center py-12 text-slate-400">{t('noInfrastructure', lang)}</div>
      ) : (
        Object.entries(byProject).map(([projectName, items]) => (
          <Card key={projectName} title={projectName}>
            <div className="space-y-3">
              {items.map((item) => (
                <InfraRow key={item.id} item={item} token={token} lang={lang} />
              ))}
            </div>
          </Card>
        ))
      )}
    </div>
  )
}

function InfraRow({ item, token, lang }: { item: InfrastructureElement; token: string; lang: string }) {
  const outputs = Object.entries(item.outputs ?? {})
  const outputLabel = outputs.length === 1 ? t('output', lang) : t('outputs', lang)
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
            {item.deployedAt ? new Date(item.deployedAt).toLocaleString() : t('notDeployed', lang)}
          </p>
          {outputs.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-blue-600 hover:text-blue-700 select-none">
                {outputs.length} {outputLabel}
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
        <InfraActions item={item} token={token} lang={lang} />
      </div>
    </div>
  )
}
