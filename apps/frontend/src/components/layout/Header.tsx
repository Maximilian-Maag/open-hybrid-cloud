'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { LanguageSwitcher } from './LanguageSwitcher'
import { CartLink } from './CartLink'
import { useLang } from '@/lib/useLang'
import { t } from '@/lib/i18n'

interface HeaderProps {
  userName?: string | null
  shopName?: string
  logoDataUrl?: string | null
  lang?: string
  /** Items in the caller's cart, rendered as the badge on the cart link. */
  cartCount?: number
}

export function Header({
  userName,
  shopName = 'Open Hybrid Cloud',
  logoDataUrl,
  lang: initialLang = 'en',
  cartCount = 0,
}: HeaderProps) {
  const router = useRouter()
  const lang = useLang(initialLang)
  const [query, setQuery] = useState('')
  // A native <details> has no dismissal behaviour: Escape does nothing and a click
  // elsewhere leaves the panel open, so it only closed by clicking the summary
  // again — unlike every other overlay in the app, which is a <dialog> via Modal.
  const accountRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const close = () => {
      const el = accountRef.current
      if (el?.open) el.open = false
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const el = accountRef.current
      if (!el?.open) return
      close()
      // Focus goes back to the control that opened it, or the panel's closing
      // leaves the user's place in the page undefined.
      el.querySelector('summary')?.focus()
    }

    const onPointerDown = (e: PointerEvent) => {
      const el = accountRef.current
      if (el?.open && e.target instanceof Node && !el.contains(e.target)) close()
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    router.push(q ? `/catalog?q=${encodeURIComponent(q)}` : '/catalog')
  }

  return (
    <header className="sticky top-0 z-50" style={{ backgroundColor: 'var(--bp)' }}>
      {/* `relative` is what the dropdown panels below anchor to on a phone. A
          panel anchored to its own 44px control has nowhere to go when that
          control sits near the right edge and the panel is 288px wide; anchored
          to this row it always lands on screen. See LanguageSwitcher.
          The row wraps below `md`, which is what gives the search field its own
          full-width line — the alternative was a 226px input competing with the
          brand and three controls inside 288px. */}
      <div className="relative max-w-screen-2xl mx-auto px-4 py-2 md:py-0 md:h-14 flex flex-wrap md:flex-nowrap items-center gap-x-3 gap-y-2 sm:gap-x-4">
        {/* Brand */}
        <Link href="/" className="order-1 flex items-center gap-2 min-w-0 shrink">
          {logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoDataUrl} alt={shopName} className="h-8 max-w-[120px] object-contain" />
          ) : (
            // `truncate`, not `whitespace-nowrap`: nowrap on a shrink-0 flex child
            // gives the row a min-content width it can never go below, and this one
            // pinned 162px of the 669px the header refused to shrink past (#167).
            <span className="font-bold text-lg tracking-tight truncate" style={{ color: 'var(--bp-ink)' }}>{shopName}</span>
          )}
        </Link>

        {/* Search.
            `basis-full` below `md` moves it to its own row rather than hiding it —
            search is the way into a catalogue, and 1.4.10 is about not losing
            functionality at 320px, not just about not scrolling sideways.
            `min-w-0` on both the form and the input is the other half of #167:
            `flex-1` leaves `min-width: auto`, so the input's default `size=20`
            (226px) plus the 48px button gave the form a 274px floor. */}
        <form onSubmit={handleSearch} className="order-3 md:order-2 grow basis-full md:basis-0 min-w-0 md:max-w-xl">
          <div className="flex items-center bg-white rounded-md overflow-hidden">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchProducts', lang)}
              aria-label={t('searchProducts', lang)}
              // min-h-11 sizes the whole search control: the submit button is
              // self-stretch, so the field is what decides whether either of them
              // clears the 44px WCAG 2.5.5 target. It was 36px.
              className="min-w-0 min-h-11 flex-1 bg-transparent px-3 py-2 text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
            />
            <button
              type="submit"
              aria-label={t('search', lang)}
              className="px-4 py-2 min-w-11 shrink-0 justify-center hover:brightness-95 transition-all flex items-center self-stretch"
              style={{ backgroundColor: 'var(--bs)', color: 'var(--bs-ink)' }}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </form>

        {/* Right controls, ending in the cart — the one control a shop is built
            around belongs at the far right, not among the section links below. */}
        <div className="order-2 md:order-3 ml-auto flex items-center gap-2 sm:gap-3">
          <LanguageSwitcher lang={lang} />

          {/* User dropdown */}
          <details ref={accountRef} className="relative group">
            {/* min-h-11: a <summary> is a pointer target, and two lines of small
                text came to 36px. */}
            <summary className="list-none cursor-pointer select-none flex items-center justify-center min-h-11 min-w-11 rounded px-1 brand-state focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
              style={{ color: 'var(--bp-ink)' }}>
              {/* Below `sm` two lines of name do not fit beside the brand, so the
                  control becomes an icon. The label is hidden with `sr-only`
                  rather than swapped for an `aria-label`, so the accessible name
                  is the same string at every width — an aria-label that replaced
                  visible text would put the announced name and the visible one out
                  of step (2.5.3 Label in Name). */}
              <svg aria-hidden="true" className="h-6 w-6 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="sr-only sm:not-sr-only sm:flex sm:flex-col sm:items-end sm:leading-tight">
                {userName && <span className="text-xs">{userName}</span>}
                <span className="text-sm font-semibold">{t('myAccount', lang)}</span>
              </span>
            </summary>
            <div
              className="absolute right-0 top-full mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1"
              onClick={() => { if (accountRef.current) accountRef.current.open = false }}
            >
              <Link href="/orders" className="flex min-h-11 items-center px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">{t('orders', lang)}</Link>
              <Link href="/projects" className="flex min-h-11 items-center px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">{t('projects', lang)}</Link>
              <hr className="my-1 border-slate-100" />
              <Link href="/settings" className="flex min-h-11 items-center px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">{t('profile', lang)}</Link>
              <hr className="my-1 border-slate-100" />
              <button
                onClick={() => signOut({ redirectTo: '/login' })}
                className="w-full text-left flex min-h-11 items-center px-4 py-2 text-sm text-slate-700 hover:text-red-600 transition-colors"
              >
                {t('signOut', lang)}
              </button>
            </div>
          </details>

          <CartLink count={cartCount} lang={lang} />
        </div>
      </div>
    </header>
  )
}
