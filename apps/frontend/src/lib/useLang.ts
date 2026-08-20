'use client'

import { useState, useEffect } from 'react'
import { useServerLang } from '@/components/layout/LangProvider'

/**
 * The language this client should render in.
 *
 * In order: the cookie (the explicit choice made in the switcher), then the value
 * the SERVER resolved for this render — passed as `initial` or taken from
 * LangProvider — and only then `navigator.language`.
 *
 * The server reads the cookie AND the Accept-Language header, and its answer can
 * differ from `navigator.language`. When it did, the chrome rendered in one
 * language and the server-rendered page beside it in another.
 */
function readLang(fallback: string): string {
  const match = document.cookie.match(/(?:^|;\s*)lang=([^;]+)/)
  return match?.[1] ?? fallback
}

export function useLang(initial?: string): string {
  const serverLang = useServerLang()
  const resolved = initial ?? serverLang ?? undefined
  const [lang, setLang] = useState(resolved ?? 'en')

  useEffect(() => {
    // Only on the client: navigator is not available during the server render, and
    // reading it there would produce a hydration mismatch.
    setLang(readLang(resolved ?? navigator.language.split('-')[0] ?? 'en'))
    const handler = (e: Event) => setLang((e as CustomEvent<string>).detail)
    window.addEventListener('langchange', handler)
    return () => window.removeEventListener('langchange', handler)
  }, [resolved])

  return lang
}
