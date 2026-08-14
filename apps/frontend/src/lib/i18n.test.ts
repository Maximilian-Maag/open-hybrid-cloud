import { describe, it, expect } from 'vitest'
import { SUPPORTED_LANGUAGES, t, isValidLang, type Translations } from './i18n'

// The English table is the reference: t() falls back to it per key, so it is the
// only one the type system requires to be complete. That fallback is a safety
// net, not a plan — a language silently rendering English is the bug this suite
// exists to catch.

describe('i18n', () => {
  it('exposes 25 EU languages', () => {
    expect(SUPPORTED_LANGUAGES.length).toBe(25)
    expect(SUPPORTED_LANGUAGES.map((l) => l.code)).toContain('de')
    expect(SUPPORTED_LANGUAGES.map((l) => l.code)).toContain('en')
  })

  it('resolves a key for every supported language', () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      expect(t('catalog', code), `catalog missing for ${code}`).toBeTruthy()
    }
  })

  it('falls back to English for an unknown language instead of throwing', () => {
    expect(t('catalog', 'xx')).toBe(t('catalog', 'en'))
  })

  it('strips a region suffix before looking the language up', () => {
    expect(t('catalog', 'de-DE')).toBe(t('catalog', 'de'))
    expect(t('catalog', 'DE')).toBe(t('catalog', 'de'))
  })

  it('recognises supported languages and rejects others', () => {
    expect(isValidLang('de')).toBe(true)
    expect(isValidLang('de-AT')).toBe(true)
    expect(isValidLang('xx')).toBe(false)
  })

  // ── Completeness ──────────────────────────────────────────────────────────
  // The chrome and admin-header keys were added late; before this suite existed
  // they were present only for en + de and every other language quietly rendered
  // English. Assert per key per language so a new string cannot ship that way.
  const CHROME_KEYS: (keyof Translations)[] = [
    'mainNavigation', 'dismiss', 'close', 'search', 'skipToContent',
    'ciSources', 'environments', 'costCenters', 'users', 'branding',
    'smtpConfiguration', 'aiConfiguration', 'exchangeRates', 'adminDashboard',
    'profileSettings', 'globalParameters',
    'categoriesSubtitle', 'ciSourcesSubtitle', 'environmentsSubtitle',
    'costCentersSubtitle', 'usersSubtitle', 'brandingSubtitle', 'smtpSubtitle',
    'aiSubtitle', 'exchangeRatesSubtitle', 'adminDashboardSubtitle',
    'profileSettingsSubtitle', 'globalParametersSubtitle',
  ]

  it('has a real translation for every chrome/admin key in every language', () => {
    const untranslated: string[] = []
    for (const { code } of SUPPORTED_LANGUAGES) {
      if (code === 'en') continue
      for (const key of CHROME_KEYS) {
        const value = t(key, code)
        expect(value, `${code}.${key} does not resolve`).toBeTruthy()
        // Identical to English means the key is absent and the fallback kicked
        // in. A handful of terms legitimately match ("Branding", "SMTP"), so
        // collect rather than fail per key and check the count below.
        if (value === t(key, 'en')) untranslated.push(`${code}.${key}`)
      }
    }
    // Loan words and proper nouns are the only acceptable matches. Anything more
    // than a sprinkling means a language is falling back wholesale.
    const perLanguage = new Map<string, number>()
    for (const entry of untranslated) {
      const code = entry.split('.')[0]
      perLanguage.set(code, (perLanguage.get(code) ?? 0) + 1)
    }
    const wholesale = [...perLanguage.entries()].filter(([, n]) => n > 4)
    expect(
      wholesale,
      `these languages look like they are falling back to English: ${wholesale
        .map(([c, n]) => `${c} (${n}/${CHROME_KEYS.length})`)
        .join(', ')}`,
    ).toEqual([])
  })

  it('never yields the string "undefined" for a known key', () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      for (const key of CHROME_KEYS) {
        expect(String(t(key, code))).not.toBe('undefined')
      }
    }
  })

  it('keeps subtitles as sentences and titles as labels', () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      // Titles are labels, so they should not be punctuated like prose.
      expect(t('adminDashboard', code), `${code} adminDashboard`).not.toMatch(/\.$/)
      expect(t('users', code), `${code} users`).not.toMatch(/\.$/)
      // Subtitles are sentences.
      expect(t('usersSubtitle', code), `${code} usersSubtitle`).toMatch(/[.!?]$/)
    }
  })
})
