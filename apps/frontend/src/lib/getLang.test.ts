import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `getLang` is the server's answer to "which language is this render in", and
 * every server component asks it. It is also the value the client chrome adopts
 * (see LangProvider / useLang), so getting it wrong renders the page in one
 * language and the chrome in another.
 */

const cookieGet = vi.fn<(name: string) => { value: string } | undefined>()
const headerGet = vi.fn<(name: string) => string | null>()

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: cookieGet }),
  headers: async () => ({ get: headerGet }),
}))

import { getLang } from './getLang'

beforeEach(() => {
  cookieGet.mockReset().mockReturnValue(undefined)
  headerGet.mockReset().mockReturnValue(null)
})

describe('getLang', () => {
  it('prefers the lang cookie over Accept-Language', () => {
    // The cookie is the explicit choice made in the switcher. A browser sending
    // `Accept-Language: en` must not undo it on the next navigation.
    cookieGet.mockReturnValue({ value: 'de' })
    headerGet.mockReturnValue('en-US,en;q=0.9')
    return expect(getLang()).resolves.toBe('de')
  })

  it('ignores a cookie holding a language the app does not have', async () => {
    // The cookie is attacker- and typo-writable. An unvalidated value reaches
    // `t()`, which falls back per key, so the page renders in English while the
    // switcher claims "ZZ" — better to not honour it at all.
    cookieGet.mockReturnValue({ value: 'zz' })
    headerGet.mockReturnValue('fr-FR,fr;q=0.9')
    await expect(getLang()).resolves.toBe('fr')
  })

  it('falls back to the header when the cookie is absent', async () => {
    headerGet.mockReturnValue('nl-BE,nl;q=0.9')
    await expect(getLang()).resolves.toBe('nl')
  })

  it('strips the region and the q-value from the first Accept-Language entry', async () => {
    // `pt-BR;q=0.8` is not a language code. Passing it through unstripped makes
    // isValidLang reject it and every visitor gets English.
    headerGet.mockReturnValue('pt-BR;q=0.8,en;q=0.7')
    await expect(getLang()).resolves.toBe('pt')
  })

  it('lower-cases the language subtag', async () => {
    // Some clients send `DE-de`. The translation tables are keyed lower-case.
    headerGet.mockReturnValue('DE-de')
    await expect(getLang()).resolves.toBe('de')
  })

  it('takes the FIRST entry, not the highest q-value, and not the last', async () => {
    headerGet.mockReturnValue('sv,de;q=0.9,en;q=0.8')
    await expect(getLang()).resolves.toBe('sv')
  })

  it('falls back to English when Accept-Language names no supported language', async () => {
    headerGet.mockReturnValue('zz-ZZ,qq;q=0.9')
    await expect(getLang()).resolves.toBe('en')
  })

  it('falls back to English when there is no Accept-Language header at all', async () => {
    // Server-to-server requests and some crawlers send none. `.split()` on the
    // resulting null would throw and take the whole page down.
    headerGet.mockReturnValue(null)
    await expect(getLang()).resolves.toBe('en')
  })

  it('falls back to English on an empty Accept-Language header', async () => {
    headerGet.mockReturnValue('')
    await expect(getLang()).resolves.toBe('en')
  })

  it('ignores an empty cookie value rather than treating it as a choice', async () => {
    cookieGet.mockReturnValue({ value: '' })
    headerGet.mockReturnValue('it-IT')
    await expect(getLang()).resolves.toBe('it')
  })

  it('reads the cookie named lang', async () => {
    cookieGet.mockImplementation((name) => (name === 'lang' ? { value: 'es' } : undefined))
    await expect(getLang()).resolves.toBe('es')
    expect(cookieGet).toHaveBeenCalledWith('lang')
  })

  it('reads the accept-language header by that name', async () => {
    headerGet.mockImplementation((name) => (name === 'accept-language' ? 'da' : null))
    await expect(getLang()).resolves.toBe('da')
    expect(headerGet).toHaveBeenCalledWith('accept-language')
  })
})

describe('getLang whitespace', () => {
  // Browsers write "de-DE, en;q=0.9" with a space after the comma, and some
  // proxies add one after the semicolon. Without the trim the first entry keeps
  // its leading space, `isValidLang(' de')` is false, and every such visitor is
  // served English while their browser plainly asked for German.
  it('trims the entry before matching it', async () => {
    headerGet.mockReturnValue('fr-FR;q=0.9')
    expect(await getLang()).toBe('fr')

    headerGet.mockReturnValue(' de-DE,en;q=0.8')
    expect(await getLang()).toBe('de')
  })
})
