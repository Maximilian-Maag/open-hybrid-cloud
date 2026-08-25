import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { LanguageSwitcher } from './LanguageSwitcher'

/**
 * Choosing a language has to do four things or the choice does not stick: write
 * the cookie the SERVER reads (`getLang`), with `path=/` so it survives
 * navigation; tell the client chrome via `langchange` (`useLang`); close the
 * menu; and refresh the server-rendered page. Each is independently droppable
 * and only the last one is visible.
 */

let cookieWrites: string[] = []

beforeEach(() => {
  refresh.mockReset()
  cookieWrites = []
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => cookieWrites.join('; '),
    set: (v: string) => { cookieWrites.push(v) },
  })
})

afterEach(() => vi.restoreAllMocks())

const toggle = () => screen.getByRole('button', { name: /^Language:/ })

describe('LanguageSwitcher trigger', () => {
  it('shows the current language code, region stripped and upper-cased', () => {
    render(<LanguageSwitcher lang="de-DE" />)
    expect(toggle()).toHaveTextContent('DE')
  })

  it('names itself with the language in its own spelling', () => {
    // "Language: DE" tells a screen-reader user nothing; "Language: Deutsch" does.
    render(<LanguageSwitcher lang="de" />)
    expect(screen.getByRole('button', { name: 'Language: Deutsch' })).toBeInTheDocument()
  })

  it('falls back to the bare code when the language is not one we ship', () => {
    render(<LanguageSwitcher lang="zz" />)
    expect(screen.getByRole('button', { name: 'Language: ZZ' })).toBeInTheDocument()
  })

  it('reports its expanded state', () => {
    render(<LanguageSwitcher lang="en" />)
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('meets the 44px target floor (WCAG 2.5.5)', () => {
    render(<LanguageSwitcher lang="en" />)
    expect(toggle()).toHaveClass('min-h-11')
    expect(toggle()).toHaveClass('min-w-11')
  })
})

describe('LanguageSwitcher menu', () => {
  it('opens on click and lists every supported language', async () => {
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="en" />)
    await user.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    // 25 languages plus the toggle itself and the click-away overlay.
    expect(screen.getByRole('button', { name: /Deutsch/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Français/ })).toBeInTheDocument()
  })

  it('closes again on a second click of the toggle', async () => {
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="en" />)
    await user.click(toggle())
    await user.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /Deutsch/ })).not.toBeInTheDocument()
  })

  it('closes on Escape and gives focus back to the toggle', async () => {
    // Unmounting the options with focus inside them drops keyboard focus to
    // <body>, and the keyboard user has to tab from the top of the page again.
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="en" />)
    await user.click(toggle())
    await user.keyboard('{Escape}')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(toggle())
  })

  it('ignores keys other than Escape', async () => {
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="en" />)
    await user.click(toggle())
    await user.keyboard('{ArrowDown}')
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not leave a document-level key listener behind when closed', async () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="en" />)
    await user.click(toggle())
    await user.click(toggle())
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function))
  })
})

describe('LanguageSwitcher selection', () => {
  async function choose(name: RegExp) {
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="en" />)
    await user.click(toggle())
    await user.click(screen.getByRole('button', { name }))
  }

  it('writes the lang cookie for the whole site, not just this path', async () => {
    // Without `path=/` the browser scopes the cookie to the page it was set on,
    // so the choice is forgotten the moment the shopper navigates.
    await choose(/Deutsch/)
    expect(cookieWrites).toHaveLength(1)
    expect(cookieWrites[0]).toContain('lang=de')
    expect(cookieWrites[0]).toContain('path=/')
  })

  it('makes the cookie outlive the session', async () => {
    // A session cookie means every visitor is back to Accept-Language tomorrow.
    await choose(/Deutsch/)
    expect(cookieWrites[0]).toContain('max-age=31536000')
    expect(cookieWrites[0]).toContain('SameSite=Lax')
  })

  it('announces the change so the client chrome re-renders without a reload', async () => {
    const handler = vi.fn()
    window.addEventListener('langchange', handler)
    await choose(/Français/)
    window.removeEventListener('langchange', handler)
    expect(handler).toHaveBeenCalledTimes(1)
    expect((handler.mock.calls[0][0] as CustomEvent<string>).detail).toBe('fr')
  })

  it('refreshes the server-rendered page, which is where most of the text is', async () => {
    await choose(/Italiano/)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('closes the menu and restores focus after choosing', async () => {
    await choose(/Español/)
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(toggle())
  })

  it('closes when clicking away from the menu', async () => {
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="en" />)
    await user.click(toggle())
    const overlay = document.querySelector('.fixed.inset-0') as HTMLElement
    expect(overlay).toBeTruthy()
    await user.click(overlay)
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })
})
