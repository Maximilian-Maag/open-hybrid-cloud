'use client'

import { useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import type { Project } from '@open-hybrid-cloud/types'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { t } from '@/lib/i18n'

/**
 * Prepend a selectable "no filter" option.
 *
 * Select's own `placeholder` renders as a DISABLED option, which is correct for a
 * required field but wrong for a filter — once a project had been picked, "all
 * projects" would be unreachable.
 */
const anyOption = (label: string, options: { value: string | number; label: string }[]) =>
  [{ value: '', label }, ...options]

interface Props {
  /** Projects the caller may filter by — the API scopes this list by role. */
  projects: Project[]
  lang: string
}

/**
 * Range and project filters for the cost report.
 *
 * The filters live in the URL, so the page stays a server component, a filtered
 * view is bookmarkable, and the export can pick the same filters up from there
 * rather than being handed them separately.
 *
 * The presets are resolved server-side: the browser's clock must not decide what
 * "last 3 months" means, or the report and its export could cover different months.
 */
export function CostFilters({ projects, lang }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const value = (key: string) => searchParams.get(key) ?? ''
  // No range at all means no lower bound, which is what the API does — so the
  // control shows "all time" rather than appearing unset.
  const range = value('range') || 'all'
  const isCustom = range === 'custom'
  const activeCount = ['range', 'projectId'].filter((key) => value(key) !== '').length

  function apply(changes: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, val] of Object.entries(changes)) {
      // Drop empty values so a cleared filter leaves a clean, shareable URL.
      if (val === '') next.delete(key)
      else next.set(key, val)
    }
    const qs = next.toString()
    startTransition(() => {
      // replace, not push: retyping a date should not bury the previous page
      // under a dozen history entries.
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  function applyRange(selected: string) {
    // 'all' is the API's default, so it is expressed by the absence of the
    // parameter. Leaving a preset behind would also let the server ignore the
    // dates, since a non-custom range wins over from/to.
    if (selected === 'all') apply({ range: '', from: '', to: '' })
    else if (selected === 'custom') apply({ range: 'custom' })
    else apply({ range: selected, from: '', to: '' })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          {t('filters', lang)}
          {activeCount > 0 && (
            <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              {activeCount}
            </span>
          )}
        </h2>
        {activeCount > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => startTransition(() => router.replace(pathname))}
          >
            {t('clearFilters', lang)}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" aria-busy={isPending}>
        <Select
          label={t('timeRange', lang)}
          value={range}
          onChange={(e) => applyRange(e.target.value)}
          options={[
            { value: 'currentMonth', label: t('currentMonth', lang) },
            { value: 'last3Months', label: t('last3Months', lang) },
            { value: 'last12Months', label: t('last12Months', lang) },
            { value: 'all', label: t('allTime', lang) },
            { value: 'custom', label: t('customRange', lang) },
          ]}
        />
        {/* Only offered for a custom range: with a preset selected the server
            ignores these dates, and an input that silently does nothing is worse
            than no input. */}
        {isCustom && (
          <>
            <Input
              label={t('fromDate', lang)}
              type="date"
              value={value('from')}
              onChange={(e) => apply({ from: e.target.value })}
            />
            <Input
              label={t('toDate', lang)}
              type="date"
              value={value('to')}
              onChange={(e) => apply({ to: e.target.value })}
            />
          </>
        )}
        <Select
          label={t('project', lang)}
          value={value('projectId')}
          onChange={(e) => apply({ projectId: e.target.value })}
          options={anyOption(t('allProjects', lang), projects.map((p) => ({ value: p.id, label: p.name })))}
        />
      </div>
    </div>
  )
}
