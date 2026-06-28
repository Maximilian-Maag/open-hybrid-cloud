'use client'

import { useRouter } from 'next/navigation'
import { SUPPORTED_LANGUAGES } from '@/lib/i18n'

interface Props {
  currentLang: string
}

export function LanguageSwitcher({ currentLang }: Props) {
  const router = useRouter()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const lang = e.target.value
    document.cookie = `lang=${lang}; path=/; max-age=31536000; SameSite=Lax`
    window.dispatchEvent(new CustomEvent('langchange', { detail: lang }))
    router.refresh()
  }

  const current = currentLang.split('-')[0].toLowerCase()

  return (
    <select
      value={current}
      onChange={handleChange}
      className="text-sm border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      aria-label="Language"
    >
      {SUPPORTED_LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.name}
        </option>
      ))}
    </select>
  )
}
