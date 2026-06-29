'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SUPPORTED_LANGUAGES } from '@/lib/i18n'

interface Props {
  lang: string
}

export function LanguageSwitcher({ lang }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const current = lang.split('-')[0].toLowerCase()

  function selectLang(code: string) {
    document.cookie = `lang=${code}; path=/; max-age=31536000; SameSite=Lax`
    window.dispatchEvent(new CustomEvent('langchange', { detail: code }))
    setOpen(false)
    router.refresh()
  }

  const currentName = SUPPORTED_LANGUAGES.find((l) => l.code === current)?.name ?? current.toUpperCase()

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-white/80 hover:text-white text-xs font-medium border border-white/20 rounded-md px-2 py-1 transition-colors focus:outline-none active:scale-95"
        aria-label={`Language: ${currentName}`}
        aria-expanded={open}
      >
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
        </svg>
        {current.toUpperCase()}
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
                  className="w-full flex flex-col items-center rounded-lg px-1 py-2 transition-colors text-center active:scale-95"
                  style={l.code === current
                    ? { backgroundColor: 'var(--bs)', color: '#111' }
                    : { color: '#475569' }
                  }
                  onMouseEnter={(e) => { if (l.code !== current) (e.currentTarget as HTMLElement).style.backgroundColor = '#f8fafc' }}
                  onMouseLeave={(e) => { if (l.code !== current) (e.currentTarget as HTMLElement).style.backgroundColor = '' }}
                >
                  <span className="font-bold text-xs">{l.code.toUpperCase()}</span>
                  <span className="block text-[10px] leading-tight truncate">{l.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
