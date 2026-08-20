'use client'

import { createContext, useContext } from 'react'

/**
 * The language the SERVER resolved for this render.
 *
 * Client components that render inside a server-rendered page cannot resolve the
 * language as well as the server already did — it reads the `lang` cookie *and*
 * the Accept-Language header. Without this they fell back to
 * `navigator.language`, which can disagree: the catalogue page rendered its
 * labels in German inside a chrome the server had rendered in English.
 */
const ServerLangContext = createContext<string | null>(null)

export function LangProvider({ lang, children }: { lang: string; children: React.ReactNode }) {
  return <ServerLangContext.Provider value={lang}>{children}</ServerLangContext.Provider>
}

/** The server-resolved language, or null outside a provider (e.g. the login page). */
export const useServerLang = (): string | null => useContext(ServerLangContext)
