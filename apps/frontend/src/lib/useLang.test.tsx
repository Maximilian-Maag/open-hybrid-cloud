import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { LangProvider } from '@/components/layout/LangProvider'
import { useLang } from './useLang'

/**
 * The precedence this hook implements is load-bearing: the bug it was written
 * for was the catalogue rendering its labels in German inside a chrome the
 * server had rendered in English, because the client resolved the language from
 * `navigator.language` and the server from the cookie AND Accept-Language.
 */

function setCookie(value: string | null) {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => (value === null ? '' : `lang=${value}`),
    set: () => {},
  })
}

function setNavigatorLanguage(value: string) {
  Object.defineProperty(window.navigator, 'language', { configurable: true, value })
}

const withProvider = (lang: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <LangProvider lang={lang}>{children}</LangProvider>
  }

beforeEach(() => {
  setCookie(null)
  setNavigatorLanguage('fr-FR')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useLang precedence', () => {
  it('uses the cookie even when the server passed something else', () => {
    setCookie('de')
    const { result } = renderHook(() => useLang('en'))
    expect(result.current).toBe('de')
  })

  it('uses the SERVER value, not navigator.language, when there is no cookie', () => {
    // The regression this hook exists for: navigator said fr, the server said en,
    // and the page rendered half in each.
    const { result } = renderHook(() => useLang('en'))
    expect(result.current).toBe('en')
  })

  it('takes the server value from LangProvider when no initial prop is given', () => {
    const { result } = renderHook(() => useLang(), { wrapper: withProvider('es') })
    expect(result.current).toBe('es')
  })

  it('lets an explicit initial prop win over the provider', () => {
    const { result } = renderHook(() => useLang('it'), { wrapper: withProvider('es') })
    expect(result.current).toBe('it')
  })

  it('falls back to navigator.language only when neither cookie nor server value exists', () => {
    setNavigatorLanguage('nl-NL')
    const { result } = renderHook(() => useLang())
    expect(result.current).toBe('nl')
  })

  it('strips the region from navigator.language', () => {
    setNavigatorLanguage('pt-BR')
    const { result } = renderHook(() => useLang())
    expect(result.current).toBe('pt')
  })

  it('picks the lang cookie out of a jar holding other cookies', () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'theme=dark; lang=sv; session=abc',
      set: () => {},
    })
    const { result } = renderHook(() => useLang('en'))
    expect(result.current).toBe('sv')
  })

  it('does not match a cookie whose name merely ends in "lang"', () => {
    // `sublang=de` must not be read as the language choice.
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'sublang=de',
      set: () => {},
    })
    const { result } = renderHook(() => useLang('en'))
    expect(result.current).toBe('en')
  })
})

describe('useLang langchange event', () => {
  it('adopts the language the switcher announces', () => {
    const { result } = renderHook(() => useLang('en'))
    act(() => {
      window.dispatchEvent(new CustomEvent('langchange', { detail: 'hu' }))
    })
    expect(result.current).toBe('hu')
  })

  it('stops listening once unmounted', () => {
    // Every page mounts several of these. A listener left behind sets state on
    // an unmounted tree on every language switch.
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useLang('en'))
    unmount()
    expect(remove).toHaveBeenCalledWith('langchange', expect.any(Function))
  })

  it('re-reads the cookie when the server value changes', () => {
    const { result, rerender } = renderHook(({ l }: { l: string }) => useLang(l), {
      initialProps: { l: 'en' },
    })
    expect(result.current).toBe('en')
    rerender({ l: 'da' })
    expect(result.current).toBe('da')
  })
})
