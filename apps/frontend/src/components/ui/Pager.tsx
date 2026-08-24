import { ButtonLink } from '@/components/ui/Button'
import { t } from '@/lib/i18n'

interface Props {
  /** Rows matching the filters, ignoring the window — the API's `total`. */
  total: number
  limit: number
  offset: number
  /** Path the links point at, without a query string. */
  path: string
  /**
   * The filters to carry across a page step. `offset` is overwritten, so a caller
   * may pass the page's own search params through unchanged.
   */
  params: URLSearchParams
  lang: string
}

/**
 * Previous/Next over a server-rendered list, with the window in the URL.
 *
 * A link rather than a button because these pages are server components: the
 * filters already live in the query string, so the page window belongs there too
 * — a bookmarked or shared page-3 URL then shows page 3.
 *
 * The range reads as digits (`51–100 / 4212`) rather than a sentence, so it needs
 * no translation and cannot drift from the numbers it describes.
 */
export function Pager({ total, limit, offset, path, params, lang }: Props) {
  // Nothing to step through: showing a disabled pair of buttons over a single
  // page is noise.
  if (total <= limit) return null

  const href = (nextOffset: number): string => {
    const next = new URLSearchParams(params)
    if (nextOffset > 0) next.set('offset', String(nextOffset))
    else next.delete('offset')
    const qs = next.toString()
    return qs ? `${path}?${qs}` : path
  }

  const first = offset + 1
  const last = Math.min(offset + limit, total)
  const hasPrevious = offset > 0
  const hasNext = last < total

  // A plain div, not a <nav>: a second labelled landmark on a page that already
  // has breadcrumbs needs a translated name, and the two links label themselves.
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-slate-500">
        {first}–{last} / {total}
      </p>
      <div className="flex gap-2">
        {hasPrevious && (
          <ButtonLink href={href(Math.max(0, offset - limit))} variant="secondary" size="sm" rel="prev">
            {t('previous', lang)}
          </ButtonLink>
        )}
        {hasNext && (
          <ButtonLink href={href(offset + limit)} variant="secondary" size="sm" rel="next">
            {t('next', lang)}
          </ButtonLink>
        )}
      </div>
    </div>
  )
}
