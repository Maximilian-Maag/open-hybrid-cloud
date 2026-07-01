'use client'

import { useState, useEffect } from 'react'

function readLangCookie(): string {
  const match = document.cookie.match(/(?:^|;\s*)lang=([^;]+)/)
  return match?.[1] ?? navigator.language.split('-')[0] ?? 'en'
}

export function useLang(initial = 'en'): string {
  const [lang, setLang] = useState(initial)

  useEffect(() => {
    setLang(readLangCookie())
    const handler = (e: Event) => setLang((e as CustomEvent<string>).detail)
    window.addEventListener('langchange', handler)
    return () => window.removeEventListener('langchange', handler)
  }, [])

  return lang
}
