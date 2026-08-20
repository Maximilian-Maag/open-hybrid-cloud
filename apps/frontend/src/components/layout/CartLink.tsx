'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { t } from '@/lib/i18n'

/**
 * Fired by every cart mutation so the header count updates without a reload.
 *
 * Same shape as the existing `langchange` event: the mutation knows the new count,
 * so it hands it over rather than making this component re-fetch and guess.
 */
export const CART_CHANGE_EVENT = 'cartchange'

/** Tell the header how many items the cart now holds. */
export const publishCartCount = (count: number): void => {
  window.dispatchEvent(new CustomEvent<number>(CART_CHANGE_EVENT, { detail: count }))
}

interface Props {
  /** Server-rendered count, so the badge is right on first paint. */
  count: number
  lang: string
}

/**
 * Cart entry point in the header, at the far right where a shopper looks for it.
 *
 * It used to be one link among the others in the section nav, which put the single
 * thing a shop is built around on the same footing as "Audit log" — and gave it
 * nowhere to show how many items were waiting.
 *
 * The accessible name is deliberately just "Cart": the badge is decorative here and
 * marked as such, and the cart page states the count in text. A name that changed
 * with the count ("Cart, 3 items") would be re-announced on every add.
 */
export function CartLink({ count: initialCount, lang }: Props) {
  const [count, setCount] = useState(initialCount)

  // Adopt the server's count when the page re-renders (router.refresh after a
  // mutation, or a plain navigation).
  useEffect(() => { setCount(initialCount) }, [initialCount])

  useEffect(() => {
    const handler = (e: Event) => setCount((e as CustomEvent<number>).detail)
    window.addEventListener(CART_CHANGE_EVENT, handler)
    return () => window.removeEventListener(CART_CHANGE_EVENT, handler)
  }, [])

  return (
    <Link
      href="/cart"
      aria-label={t('cart', lang)}
      className="flex items-end gap-1 rounded px-1 py-0.5 brand-state focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
      style={{ color: 'var(--bp-ink)' }}
    >
      <span className="relative">
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        {count > 0 && (
          <span
            aria-hidden="true"
            data-testid="cart-count"
            className="absolute -top-1 -right-1.5 min-w-4 rounded-full px-1 text-center text-[11px] font-bold leading-4"
            style={{ backgroundColor: 'var(--bs)', color: 'var(--bs-ink)' }}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      <span className="hidden sm:inline text-sm font-semibold">{t('cart', lang)}</span>
    </Link>
  )
}
