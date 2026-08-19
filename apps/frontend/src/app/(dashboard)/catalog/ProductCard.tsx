'use client'

import Link from 'next/link'
import { t } from '@/lib/i18n'
import { FavoriteButton } from './FavoriteButton'
import { ProductImage } from '@/components/ui/ProductImage'

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
        className="relative h-40 border-b border-slate-100"
        style={{ backgroundColor: 'color-mix(in srgb, var(--bp) 8%, white)' }}
      >
        {/* The picture is the obvious thing to click, so it is the link. Named for
            the product rather than left nameless: when the fallback placeholder
            renders there is no alt text for the link to borrow. */}
        <Link
          href={`/catalog/${id}`}
          aria-label={name}
          className="block h-full w-full p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
        >
          <ProductImage productId={id} name="" />
        </Link>
        {/* A SIBLING of the link, not a child: a button inside a link is
            nested-interactive, which the axe gate in e2e/a11y.spec.ts rejects. */}
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
        {/* "Details", not "Place Order": it opens the product page, where the
            environment, the price and the parameters are chosen. Promising an order
            and delivering a form is a broken promise. */}
        <Link
          href={`/catalog/${id}`}
          className="w-full py-2 px-3 rounded text-center text-sm font-semibold block text-gray-900 hover:brightness-95 transition-all mt-auto"
          style={{ backgroundColor: 'var(--bs)' }}
        >
          {t('details', lang)}
        </Link>
      </div>
    </div>
  )
}
