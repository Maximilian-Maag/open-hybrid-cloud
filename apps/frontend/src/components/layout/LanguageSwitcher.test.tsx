import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { LanguageSwitcher } from './LanguageSwitcher'
import { SUPPORTED_LANGUAGES, t } from '@/lib/i18n'

/**
 * The three defects the language menu had, all of them invisible to a page scan
 * (#186).
 *
 * There is nothing missing for axe to report in any of them: the button has a
 * name, the list has 25 named buttons, and the endonyms are perfectly good text.
 * What is missing is the relationship between what is drawn and what is meant.
 */
describe('LanguageSwitcher', () => {
  const open = async () => {
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="de" />)
    await user.click(screen.getByRole('button', { name: /sprache/i }))
    return user
  }

  it('keeps the visible label inside the accessible name (2.5.3)', () => {
    // The name was `Language: Deutsch` while the visible label was `DE`, so a
    // voice-control user saying "click DE" found nothing — and the qualifier was
    // the only aria-label in the app not built from t(), so it stayed English
    // inside a lang="de" document (3.1.2).
    render(<LanguageSwitcher lang="de" />)
    const toggle = screen.getByRole('button', { expanded: false })
    const name = toggle.textContent ?? ''

    expect(name.startsWith('DE')).toBe(true)
    expect(name).toContain(t('language', 'de'))
    expect(name).toContain('Deutsch')
    expect(name).not.toContain('Language:')
  })

  it('marks which of the 25 languages is in effect', async () => {
    // A background colour and nothing else, so the menu announced 25 identical
    // buttons and a screen-reader user could not tell which one was active
    // (1.4.1, 4.1.2).
    await open()

    const current = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-current'))
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain('Deutsch')
  })

  it('tags every endonym with the language it is written in (3.1.2)', async () => {
    // This is the only place in the frontend where 25 languages appear at once,
    // and without a `lang` a German voice reads Ελληνικά with German phonemes.
    await open()

    // Collected rather than queried one by one: the toggle carries a tagged
    // endonym of its own, so "Deutsch" legitimately appears twice.
    const tagged = Array.from(document.querySelectorAll<HTMLElement>('span[lang]'))
    for (const { code, name } of SUPPORTED_LANGUAGES) {
      expect(
        tagged.some((el) => el.getAttribute('lang') === code && el.textContent === name),
        `${name} should be tagged lang="${code}"`,
      ).toBe(true)
    }
  })
})
