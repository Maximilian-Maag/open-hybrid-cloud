'use client'

import { useState, useEffect } from 'react'

/**
 * The language this client should render in.
 *
 * The cookie wins — it is the explicit choice made in the switcher. Failing that,
 * the value the SERVER resolved for this render (`initial`), not
 * `navigator.language`: the server already looked at the cookie and the
 * Accept-Language header, and those two signals can disagree with
 * `navigator.language`. When they did, the chrome rendered in one language and the
 * server-rendered page beside it in another. navigator.language stays as the last
 * resort for the callers that have no server-resolved value to pass.
 */
function readLang(fallback: string): string {
  const match = document.cookie.match(/(?:^|;\s*)lang=([^;]+)/)
  return match?.[1] ?? fallback
}

export function useLang(initial?: string): string {
  const [lang, setLang] = useState(initial ?? 'en')

  useEffect(() => {
    // Only on the client: navigator is not available during the server render, and
    // reading it there would produce a hydration mismatch.
    setLang(readLang(initial ?? navigator.language.split('-')[0] ?? 'en'))
    const handler = (e: Event) => setLang((e as CustomEvent<string>).detail)
    window.addEventListener('langchange', handler)
    return () => window.removeEventListener('langchange', handler)
  }, [initial])

  return lang
}
