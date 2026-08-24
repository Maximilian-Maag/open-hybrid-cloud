'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SUPPORTED_LANGUAGES, t } from '@/lib/i18n'

interface Props {
  lang: string
}

export function LanguageSwitcher({ lang }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const current = lang.split('-')[0].toLowerCase()

  // Allow keyboard users to dismiss the open dropdown with Escape. Restore focus
  // to the toggle so keyboard focus isn't dropped to <body> when options unmount.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function selectLang(code: string) {
    document.cookie = `lang=${code}; path=/; max-age=31536000; SameSite=Lax`
    window.dispatchEvent(new CustomEvent('langchange', { detail: code }))
    setOpen(false)
    toggleRef.current?.focus()
    router.refresh()
  }

  const currentName = SUPPORTED_LANGUAGES.find((l) => l.code === current)?.name ?? current.toUpperCase()

  return (
    <div className="relative">
      <button
        ref={toggleRef}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center gap-1 min-h-11 min-w-11 text-xs font-medium border border-current/40 rounded-md px-2 py-1 brand-state focus:outline-none focus-visible:ring-2 focus-visible:ring-current active:scale-95"
        style={{ color: 'var(--bp-ink)' }}
        aria-expanded={open}
      >
        <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
        </svg>
        {current.toUpperCase()}
        {/* Built from the visible label outward instead of replacing it. The
            aria-label here was `Language: ${currentName}` — the only aria-label
            in the app not built from t(), so it stayed English inside a
            lang="de" document (3.1.2), AND it discarded the visible "DE",
            which is what 2.5.3 Label in Name is about: a voice-control user
            saying "click DE" found nothing. As visually hidden text it appends
            to the visible label rather than replacing it, and the endonym
            carries its own lang for the same reason the list below does. */}
        <span className="sr-only">
          {' — '}{t('language', lang)}: <span lang={current}>{currentName}</span>
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 bg-white rounded-xl shadow-xl border border-slate-200 p-3 w-72 animate-slide-down">
            <div className="grid grid-cols-3 gap-1 max-h-64 overflow-y-auto pr-1">
              {SUPPORTED_LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => selectLang(l.code)}
                  // Which of the 25 is in effect was a background colour and
                  // nothing more, so this menu announced 25 identical buttons
                  // (1.4.1, 4.1.2). aria-current, not aria-pressed: picking one
                  // deselects the others — it is the current item in a set, the
                  // same relationship the top nav marks on its active link.
                  aria-current={l.code === current ? true : undefined}
                  // 25 of these in a 3-column grid, so the floor matters: two lines
                  // of 10-12px type landed within a pixel of 44 by accident.
                  className="w-full flex flex-col items-center justify-center min-h-11 rounded-lg px-1 py-2 transition-colors text-center active:scale-95"
                  style={l.code === current
                    ? { backgroundColor: 'var(--bs)', color: 'var(--bs-ink)' }
                    : { color: '#475569' }
                  }
                  onMouseEnter={(e) => { if (l.code !== current) (e.currentTarget as HTMLElement).style.backgroundColor = '#f8fafc' }}
                  onMouseLeave={(e) => { if (l.code !== current) (e.currentTarget as HTMLElement).style.backgroundColor = '' }}
                >
                  <span className="font-bold text-xs">{l.code.toUpperCase()}</span>
                  {/* The endonym is written in the language it names, inside a
                      document declared as some other one — so it needs its own
                      `lang` or a German voice reads Ελληνικά with German
                      phonemes (3.1.2). This is the only place in the frontend
                      where 25 languages appear at once. */}
                  <span lang={l.code} className="block text-[10px] leading-tight truncate">{l.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
