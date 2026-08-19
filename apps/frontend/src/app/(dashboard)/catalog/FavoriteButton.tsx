'use client'

import { t } from '@/lib/i18n'

interface Props {
  favorited: boolean
  busy?: boolean
  onToggle: () => void
  lang: string
}

/**
 * Star toggle for a catalogue product.
 *
 * A real button with `aria-pressed` rather than a styled icon: the two states
 * differ only by fill colour, which is invisible to a screen reader and to anyone
 * who cannot distinguish the two shades.
 */
export function FavoriteButton({ favorited, busy = false, onToggle, lang }: Props) {
  const label = favorited ? t('removeFromFavorites', lang) : t('addToFavorites', lang)
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={favorited}
      aria-label={label}
      title={label}
      data-testid={`favorite-toggle-${favorited ? 'on' : 'off'}`}
      className="rounded-full bg-white/90 p-1.5 shadow-sm transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
    >
      <svg
        className={`h-5 w-5 ${favorited ? 'text-yellow-500' : 'text-slate-400'}`}
        fill={favorited ? 'currentColor' : 'none'}
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M11.48 3.5a.56.56 0 011.04 0l2.13 4.72 5.15.6a.56.56 0 01.31.97l-3.8 3.53.99 5.09a.56.56 0 01-.83.59L12 16.42l-4.47 2.58a.56.56 0 01-.83-.59l1-5.09-3.81-3.53a.56.56 0 01.31-.97l5.15-.6 2.13-4.72z"
        />
      </svg>
    </button>
  )
}
