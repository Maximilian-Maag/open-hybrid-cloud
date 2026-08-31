import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

// Not by accessible name: that name is translated now, so it is "Sprache: DE –
// Deutsch" on a German page and matching it here would mean re-deriving the
// label the component is under test for. `aria-expanded` is on the toggle and
// nowhere else.
const toggle = () => document.querySelector('button[aria-expanded]') as HTMLElement

describe('LanguageSwitcher trigger', () => {
  it('shows the current language code, region stripped and upper-cased', () => {
    render(<LanguageSwitcher lang="de-DE" />)
    expect(toggle()).toHaveTextContent('DE')
  })

  it('names itself in the page language, with the visible code inside the name', () => {
    // Three promises in one string. The word is translated, so a German page
    // does not name its own control in English (WCAG 3.1.2). The code is there,
    // because the visible label is `DE` and an accessible name that does not
    // contain it leaves speech control with nothing to say (WCAG 2.5.3). And
    // the endonym is still there, because "Sprache: DE" does not tell a
    // screen-reader user which language DE is.
    render(<LanguageSwitcher lang="de" />)
    expect(screen.getByRole('button', { name: 'Sprache: DE – Deutsch' })).toBeInTheDocument()
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

  // The effect returns early while the menu is closed, so nothing is listening.
  // Registering regardless would still pass the cleanup test above — the handler
  // is removed either way — and the difference only shows here: a closed
  // switcher that listens will pull focus to its own toggle when the user
  // presses Escape to dismiss something else entirely.
  it('does not grab focus when Escape is pressed with the menu closed', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <LanguageSwitcher lang="en" />
        <button type="button">somewhere else</button>
      </div>,
    )
    const elsewhere = screen.getByRole('button', { name: /somewhere else/i })
    elsewhere.focus()

    await user.keyboard('{Escape}')

    expect(document.activeElement).toBe(elsewhere)
  })

  // The grid shows the bare code above the language's own name. Lower-casing it
  // makes 'DE' read as the German word 'de', which is a different word.
  it('shows each code upper-cased in the grid', async () => {
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="en" />)
    await user.click(toggle())

    const german = screen.getByRole('button', { name: /Deutsch/ })
    expect(german.textContent).toContain('DE')
    expect(german.textContent).not.toContain('de<')
    expect(within(german).getByText('DE')).toBeInTheDocument()
  })

  it('marks the language in effect, which colour alone does not', async () => {
    // 25 buttons that differ only by fill: without this a screen-reader user
    // hears the whole list and cannot tell which one they are already on
    // (WCAG 1.4.1, 4.1.2).
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="de" />)
    await user.click(toggle())

    expect(screen.getByRole('button', { name: /^DE\s*Deutsch$/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /^FR\s*Français$/ })).not.toHaveAttribute('aria-current')
  })

  it('tags each endonym with its own language', async () => {
    // `Ελληνικά` inside a German document is read with German phonemes unless
    // the span says otherwise (WCAG 3.1.2 Language of Parts).
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="de" />)
    await user.click(toggle())

    expect(screen.getByText('Ελληνικά')).toHaveAttribute('lang', 'el')
    expect(screen.getByText('Français')).toHaveAttribute('lang', 'fr')
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

// The grid marks the current language, and reacts to the pointer, with inline
// background colours and nothing else. That makes those styles behaviour rather
// than decoration: they are the only thing telling a sighted user which of the
// 25 is selected, and the only feedback the mouse gets.
describe('LanguageSwitcher grid states', () => {
  // The toggle's name ends in the endonym too, so a loose /Deutsch/ matches two
  // buttons. The grid options are named by their code and their own spelling.
  const optionFor = (code: string, name: string) =>
    screen.getByRole('button', { name: new RegExp(`^${code}\\s*${name}$`) })

  it('paints the current language differently from the rest', async () => {
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="de" />)
    await user.click(toggle())

    const german = optionFor('DE', 'Deutsch')
    const french = optionFor('FR', 'Français')

    expect(german.style.backgroundColor).not.toBe('')
    expect(french.style.backgroundColor).toBe('')
    expect(german.style.color).not.toBe(french.style.color)
  })

  it('moves the marking when a different language is current', async () => {
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="fr" />)
    await user.click(toggle())

    expect(optionFor('FR', 'Français').style.backgroundColor).not.toBe('')
    expect(optionFor('DE', 'Deutsch').style.backgroundColor).toBe('')
  })

  it('tints an option under the pointer and clears it again', async () => {
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="de" />)
    await user.click(toggle())
    const french = optionFor('FR', 'Français')

    await user.hover(french)
    expect(french.style.backgroundColor).not.toBe('')

    await user.unhover(french)
    expect(french.style.backgroundColor).toBe('')
  })

  // Hovering the selected one must not repaint it: the hover tint is a pale
  // grey, so applying it would wipe out the marking that says "this is the one
  // you are on" for as long as the pointer rests there.
  it('leaves the current language alone under the pointer', async () => {
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="de" />)
    await user.click(toggle())
    const german = optionFor('DE', 'Deutsch')
    const before = german.style.backgroundColor

    await user.hover(german)
    expect(german.style.backgroundColor).toBe(before)

    await user.unhover(german)
    expect(german.style.backgroundColor).toBe(before)
  })
})

describe('LanguageSwitcher branding surface', () => {
  it('writes the toggle in the primary ink', () => {
    render(<LanguageSwitcher lang="en" />)
    expect(toggle().style.color).toBe('var(--bp-ink)')
  })

  // The selected option is marked with the secondary and its derived ink; the
  // rest take a fixed slate, because they sit on white rather than on branding.
  it('marks the current option with the secondary, and the rest with slate', async () => {
    const user = userEvent.setup()
    render(<LanguageSwitcher lang="de" />)
    await user.click(toggle())

    const german = screen.getByRole('button', { name: /^DE\s*Deutsch$/ })
    const french = screen.getByRole('button', { name: /^FR\s*Français$/ })
    expect(german.style.backgroundColor).toBe('var(--bs)')
    expect(german.style.color).toBe('var(--bs-ink)')
    expect(french.style.color).toBe('rgb(71, 85, 105)')
  })
})
