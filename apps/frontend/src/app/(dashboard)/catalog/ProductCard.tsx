'use client'

import Link from 'next/link'
import { t } from '@/lib/i18n'
import { FavoriteButton } from './FavoriteButton'

interface Props {
  id: number
  name: string
  description: string
  categoryName?: string
  favorited: boolean
  busy?: boolean
  onToggleFavorite: () => void
  lang: string
}

/**
 * One catalogue product tile.
 *
 * Extracted from the catalogue page so the "My Favorites" section and the main
 * grid render identical cards — a favourite that looked different from the same
 * product below it would read as a different thing.
 */
export function ProductCard({
  id,
  name,
  description,
  categoryName,
  favorited,
  busy,
  onToggleFavorite,
  lang,
}: Props) {
  return (
    <div
      data-testid={`product-card-${id}`}
      className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col hover:shadow-md transition-all"
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--bp)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}
    >
      <div
        className="relative h-40 flex items-center justify-center border-b border-slate-100"
        style={{ backgroundColor: 'color-mix(in srgb, var(--bp) 8%, white)' }}
      >
        <svg className="h-14 w-14 opacity-25" style={{ color: 'var(--bp-text)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
        </svg>
        <div className="absolute top-2 right-2">
          <FavoriteButton favorited={favorited} busy={busy} onToggle={onToggleFavorite} lang={lang} />
        </div>
      </div>
      <div className="p-3 flex flex-col flex-1">
        {categoryName && (
          <span className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--bp-text)' }}>
            {categoryName}
          </span>
        )}
        <h3 className="font-semibold text-sm text-slate-800 leading-snug mb-1 line-clamp-2">{name}</h3>
        {description && (
          <p className="text-xs text-slate-500 leading-relaxed flex-1 mb-3 line-clamp-2">{description}</p>
        )}
        <Link
          href={`/catalog/${id}`}
          className="w-full py-2 px-3 rounded text-center text-sm font-semibold block text-gray-900 hover:brightness-95 transition-all mt-auto"
          style={{ backgroundColor: 'var(--bs)' }}
        >
          {t('placeOrder', lang)}
        </Link>
      </div>
    </div>
  )
}
