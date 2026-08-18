import { auth } from '@/lib/auth'
import { get } from '@/lib/api'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { InfrastructureElement, InfraFacets, Role } from '@open-hybrid-cloud/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { InfraActions } from './InfraActions'
import { InfraFilters } from './InfraFilters'
import { InfraExport } from './InfraExport'
import { t, isValidLang } from '@/lib/i18n'

// Filters live in the URL (see InfraFilters), so every distinct filter
// combination is its own render — nothing here may be cached across them.
export const dynamic = 'force-dynamic'

/** Query parameters forwarded to the API verbatim; anything else is ignored. */
const FILTER_KEYS = [
  'search', 'status', 'environmentId', 'projectId', 'productId',
  'deployedFrom', 'deployedTo', 'sort', 'direction',
] as const

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

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function InfrastructurePage({ searchParams }: Props) {
  const session = await auth()
  if (!session) redirect('/login')

  const token = (session as unknown as { apiToken: string }).apiToken
  const lang = await detectLang()
  const params = await searchParams
  // The export endpoint is admin-and-above, so don't offer a button that would
  // only ever come back 403.
  const role = (session.user as unknown as { role: Role }).role
  const canExport = role === 'admin' || role === 'root'

  const query = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const raw = params[key]
    // Take the first value if a key was repeated: the API expects one, and
    // guessing which of two conflicting values was meant is worse than picking.
    const value = Array.isArray(raw) ? raw[0] : raw
    if (value) query.set(key, value)
  }
  const qs = query.toString()
  const isFiltered = qs !== ''

  const [listRes, facetsRes] = await Promise.allSettled([
    get<InfrastructureElement[]>(`/api/infrastructure${qs ? `?${qs}` : ''}`, token),
    get<InfraFacets>('/api/infrastructure/facets', token),
  ])

  const elements = listRes.status === 'fulfilled' ? (listRes.value ?? []) : []
  // Empty facets degrade to unpopulated dropdowns rather than a broken page —
  // the free-text search and date filters still work.
  const facets = facetsRes.status === 'fulfilled'
    ? (facetsRes.value ?? { environments: [], projects: [], products: [] })
    : { environments: [], projects: [], products: [] }

  // Group by project — but only for the default date ordering. Bucketing by
  // project silently overrides an explicit name or status sort, since the group
  // a row lands in matters more than its position within it, so an explicit
  // sort gets a flat list that actually honours it.
  const sort = Array.isArray(params.sort) ? params.sort[0] : params.sort
  const grouped = !sort || sort === 'date'
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
        actions={canExport ? <InfraExport token={token} lang={lang} /> : undefined}
      />

      <InfraFilters facets={facets} lang={lang} resultCount={elements.length} />

      {elements.length === 0 ? (
        <div className="text-center py-12 text-slate-600">
          {/* Distinguish "nothing deployed" from "nothing matches" — the first is
              a state to act on, the second means the filters are too narrow. */}
          {isFiltered ? t('noMatchingInfrastructure', lang) : t('noInfrastructure', lang)}
        </div>
      ) : grouped ? (
        Object.entries(byProject).map(([projectName, items]) => (
          <Card key={projectName} title={projectName}>
            <div className="space-y-3">
              {items.map((item) => (
                <InfraRow key={item.id} item={item} token={token} lang={lang} />
              ))}
            </div>
          </Card>
        ))
      ) : (
        <Card>
          <div className="space-y-3">
            {elements.map((item) => (
              <InfraRow key={item.id} item={item} token={token} lang={lang} showProject />
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function InfraRow({
  item,
  token,
  lang,
  showProject = false,
}: {
  item: InfrastructureElement
  token: string
  lang: string
  /** Set in the flat (explicitly-sorted) view, where no Card header names it. */
  showProject?: boolean
}) {
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
            <StatusBadge status={item.status} lang={lang} />
          </div>
          <p className="text-xs text-slate-500">
            {showProject && <>{item.projectName ?? `Project #${item.projectId}`} · </>}
            {item.environmentName} ·{' '}
            {item.deployedAt ? new Date(item.deployedAt).toLocaleString(lang) : t('notDeployed', lang)}
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
