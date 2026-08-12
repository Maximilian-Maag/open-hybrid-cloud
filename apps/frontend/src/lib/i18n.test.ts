import { describe, it, expect } from 'vitest'
import { t, isValidLang, SUPPORTED_LANGUAGES } from './i18n'

describe('i18n', () => {
  it('has a non-empty translation of a sample key in every supported language', () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      const value = t('signOut', code)
      expect(value, `signOut missing for ${code}`).toBeTruthy()
      expect(typeof value).toBe('string')
    }
  })

  it('translates the status keys used by StatusBadge in every language', () => {
    const statusKeys = [
      'statusPending', 'statusProvisioning', 'statusCompleted',
      'statusFailed', 'statusRejected', 'statusActive', 'statusDecommissioned',
    ] as const
    for (const { code } of SUPPORTED_LANGUAGES) {
      for (const key of statusKeys) {
        expect(t(key, code), `${key} missing for ${code}`).toBeTruthy()
      }
    }
  })

  it('falls back to English for an unknown language', () => {
    expect(t('signOut', 'zz')).toBe(t('signOut', 'en'))
  })

  it('normalizes region subtags (de-DE → de)', () => {
    expect(t('signOut', 'de-DE')).toBe(t('signOut', 'de'))
  })

  it('validates supported language codes', () => {
    expect(isValidLang('de')).toBe(true)
    expect(isValidLang('en-US')).toBe(true)
    expect(isValidLang('zz')).toBe(false)
  })
})
