'use client'

import { useEffect, useState } from 'react'
import type { ProductVersion, ProductVersionDiff } from '@open-hybrid-cloud/types'
import { get } from '@/lib/api'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { t } from '@/lib/i18n'

interface Props {
  productId: number
  token: string
  lang?: string
}

/**
 * Catalogue change history for a product, with a diff between any two entries
 * (issue #38).
 *
 * Loaded on mount rather than server-rendered with the page: the history is a
 * reference panel, and a slow or failing read of it must not delay or break the
 * edit form above it.
 */
export function ProductVersionHistory({ productId, token, lang = 'en' }: Props) {
  const [versions, setVersions] = useState<ProductVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [diff, setDiff] = useState<ProductVersionDiff | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    get<ProductVersion[]>(`/api/admin/products/${productId}/versions`, token)
      .then((rows) => {
        if (stale) return
        const list = rows ?? []
        setVersions(list)
        // Preselect the most recent pair that can actually be compared, so the
        // common case — "what did my last change do?" — is one click.
        const comparable = list.filter((v) => v.snapshot !== null)
        if (comparable.length >= 2) {
          setToId(String(comparable[0].id))
          setFromId(String(comparable[1].id))
        }
      })
      .catch((e) => { if (!stale) setError(e instanceof Error ? e.message : 'Failed to load the history.') })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [productId, token])

  async function handleCompare() {
    setDiffError(null)
    setDiff(null)
    try {
      setDiff(
        await get<ProductVersionDiff>(
          `/api/admin/products/${productId}/versions/diff?from=${fromId}&to=${toId}`,
          token,
        ),
      )
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : 'Failed to compare the versions.')
    }
  }

  // Only entries with a snapshot can be diffed; a product-level change (a rename)
  // has no offering configuration to compare.
  const comparable = versions.filter((v) => v.snapshot !== null)
  const options = comparable.map((v) => ({
    value: v.id,
    label: `#${v.id} · ${new Date(v.createdAt).toLocaleString(lang)} · ${v.summary}`,
  }))

  if (loading) return <p className="text-sm text-slate-600">{t('loading', lang)}</p>
  if (error) return <Alert>{error}</Alert>

  return (
    <div className="space-y-4">
      {versions.length === 0 ? (
        <p className="text-sm text-slate-600">{t('noVersionHistory', lang)}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm divide-y divide-slate-100">
            <thead>
              <tr>
                <th className="text-left py-2 pr-4 font-medium text-slate-500">{t('date', lang)}</th>
                <th className="text-left py-2 pr-4 font-medium text-slate-500">{t('environment', lang)}</th>
                <th className="text-left py-2 pr-4 font-medium text-slate-500">{t('changes', lang)}</th>
                <th className="text-left py-2 pr-4 font-medium text-slate-500">{t('changelog', lang)}</th>
                <th className="text-left py-2 font-medium text-slate-500">{t('user', lang)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {versions.map((version) => (
                <tr key={version.id} data-testid={`version-${version.id}`}>
                  <td className="py-2 pr-4 text-xs text-slate-600 whitespace-nowrap">
                    {new Date(version.createdAt).toLocaleString(lang)}
                  </td>
                  <td className="py-2 pr-4 text-xs text-slate-600">
                    {/* A dash rather than a blank: a product-level change genuinely
                        has no environment, which is different from missing data. */}
                    {version.environmentName ?? '—'}
                  </td>
                  <td className="py-2 pr-4 text-xs text-slate-900">{version.summary}</td>
                  <td className="py-2 pr-4 text-xs text-slate-700 whitespace-pre-wrap">
                    {version.changelog || '—'}
                  </td>
                  <td className="py-2 text-xs text-slate-600">{version.authorName ?? t('system', lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {comparable.length >= 2 && (
        <div className="border-t border-slate-100 pt-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label={t('fromDate', lang)}
              value={fromId}
              onChange={(e) => { setFromId(e.target.value); setDiff(null) }}
              options={options}
            />
            <Select
              label={t('toDate', lang)}
              value={toId}
              onChange={(e) => { setToId(e.target.value); setDiff(null) }}
              options={options}
            />
          </div>
          <Button size="sm" onClick={handleCompare} disabled={!fromId || !toId}>
            {t('compare', lang)}
          </Button>

          {diffError && <Alert>{diffError}</Alert>}

          {diff && (
            <div data-testid="version-diff" className="rounded-lg border border-slate-200 p-3 space-y-2">
              {diff.identical ? (
                <p className="text-sm text-slate-600">{t('noChanges', lang)}</p>
              ) : (
                <>
                  {/* Words, not colour and strikethrough.
                      This row is the audit trail for catalogue prices, and it
                      used to read out as "price 10.00 12.00": `line-through` is
                      not announced by default by NVDA, JAWS or VoiceOver, red
                      vs green is 1.4.1, and the arrow that carried the meaning
                      was aria-hidden. `∅` was worse than nothing — most voices
                      skip it, so a field that HAD no value read identically to
                      one that still has this one.
                      The from/now labels are visible rather than sr-only: they
                      cost one word each and they are what makes the direction
                      of the change unambiguous in print too. */}
                  {diff.fields.map((change) => (
                    <p key={change.field} className="text-sm">
                      <span className="font-medium text-slate-900">{change.field}</span>{' '}
                      <span className="text-xs text-slate-600">{t('changedFrom', lang)}</span>{' '}
                      <span className="font-mono text-xs text-red-700 line-through">
                        {change.from || t('emptyValue', lang)}
                      </span>{' '}
                      <span aria-hidden="true">→</span>{' '}
                      <span className="text-xs text-slate-600">{t('changedTo', lang)}</span>{' '}
                      <span className="font-mono text-xs text-green-700">
                        {change.to || t('emptyValue', lang)}
                      </span>
                    </p>
                  ))}
                  {diff.parameters.map((change) => (
                    <p key={`${change.kind}-${change.name}`} className="text-sm">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                        {t(change.kind === 'added' ? 'added' : change.kind === 'removed' ? 'removed' : 'changed', lang)}
                      </span>{' '}
                      <span className="font-mono text-xs text-slate-900">{change.name}</span>
                      {change.kind === 'changed' && (
                        <span className="text-xs text-slate-600">
                          {' — '}
                          {/* Same substitution as above: the arrow is the only
                              thing separating the two values here, and `∅` is
                              silent. */}
                          {change.fields
                            .map(
                              (f) =>
                                `${f.field}: ${t('changedFrom', lang)} ${f.from || t('emptyValue', lang)}` +
                                `, ${t('changedTo', lang)} ${f.to || t('emptyValue', lang)}`,
                            )
                            .join('; ')}
                        </span>
                      )}
                    </p>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
