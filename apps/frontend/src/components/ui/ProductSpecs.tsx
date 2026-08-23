import type { Parameter } from '@open-hybrid-cloud/types'
import { t } from '@/lib/i18n'

interface Props {
  /** The definitions from `GET /api/catalog/{id}` — already resolved per scope. */
  parameters: Parameter[]
  lang: string
}

/**
 * The product's parameter definitions as a specification table (issue #107).
 *
 * These are the closest thing this catalogue has to a "technical details" table,
 * and until now they were only visible once you scrolled into the order form —
 * which meant "what am I actually getting" could not be answered from the part of
 * the page that describes the product.
 *
 * A real `<table>` with header cells, not a grid of divs: the relationship between
 * "Default" and the value under it is what makes the table readable at all, and
 * that relationship only exists for a screen reader if the markup says so.
 */
export function ProductSpecs({ parameters, lang }: Props) {
  if (parameters.length === 0) return null

  // Same name twice would mean two rows claiming to define one thing. The service
  // resolves scope precedence but keeps one candidate per (name, environment)
  // while no environment is selected, so the page can still see duplicates.
  const rows = [...new Map(parameters.map((p) => [p.name, p])).values()].sort((a, b) =>
    (a.label || a.name).localeCompare(b.label || b.name, undefined, { sensitivity: 'base' }),
  )

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <caption className="sr-only">{t('specifications', lang)}</caption>
        <thead className="bg-slate-50">
          <tr>
            <th scope="col" className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t('parameter', lang)}
            </th>
            <th scope="col" className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t('type', lang)}
            </th>
            <th scope="col" className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t('defaultValue', lang)}
            </th>
            <th scope="col" className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t('required', lang)}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((parameter) => (
            <tr key={parameter.name}>
              {/* A row header, so a screen reader announces which parameter each
                  cell belongs to instead of reading four loose values. */}
              <th scope="row" className="px-4 py-2 text-left align-top font-medium text-slate-900">
                {parameter.label || parameter.name}
                {parameter.description && (
                  <span className="mt-0.5 block text-xs font-normal text-slate-500">
                    {parameter.description}
                  </span>
                )}
              </th>
              <td className="px-4 py-2 align-top text-slate-700">{parameter.type}</td>
              <td className="px-4 py-2 align-top text-slate-700">
                {/* A sensitive parameter's default is still a secret — the order
                    detail page redacts these for the same reason. */}
                {parameter.sensitive && parameter.defaultValue
                  ? t('sensitiveRedacted', lang)
                  : parameter.defaultValue || '—'}
              </td>
              <td className="px-4 py-2 align-top text-slate-700">
                {parameter.required ? t('yes', lang) : t('no', lang)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
