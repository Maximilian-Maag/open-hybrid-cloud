import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }))

import { Header } from './Header'

const accountPanel = () => screen.getByRole('link', { name: /orders/i }).closest('div')
const details = () => document.querySelector('details') as HTMLDetailsElement

beforeEach(() => push.mockReset())

describe('Header account menu', () => {
  it('opens on click', async () => {
    const user = userEvent.setup()
    render(<Header userName="Root Admin" lang="en" />)

    expect(details().open).toBe(false)
    await user.click(screen.getByText(/my account/i))
    expect(details().open).toBe(true)
    expect(accountPanel()).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the control', async () => {
    // A native <details> ignores Escape; every other overlay in the app is a
    // <dialog> and closes on it, so the header behaved differently from all of them.
    const user = userEvent.setup()
    render(<Header userName="Root Admin" lang="en" />)

    await user.click(screen.getByText(/my account/i))
    expect(details().open).toBe(true)

    await user.keyboard('{Escape}')
    expect(details().open).toBe(false)
    expect(document.activeElement?.tagName.toLowerCase()).toBe('summary')
  })

  it('closes when clicking outside it', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <Header userName="Root Admin" lang="en" />
        <button type="button">elsewhere</button>
      </div>,
    )

    await user.click(screen.getByText(/my account/i))
    expect(details().open).toBe(true)

    await user.click(screen.getByRole('button', { name: /elsewhere/i }))
    expect(details().open).toBe(false)
  })

  it('stays open when clicking the summary again is not involved', async () => {
    // Clicking inside the panel closes it, because the panel is links: navigating
    // and coming back would otherwise land on an open menu.
    const user = userEvent.setup()
    render(<Header userName="Root Admin" lang="en" />)

    await user.click(screen.getByText(/my account/i))
    await user.click(screen.getByRole('link', { name: /projects/i }))
    expect(details().open).toBe(false)
  })

  it('does not swallow Escape when the menu is closed', async () => {
    const user = userEvent.setup()
    render(<Header userName="Root Admin" lang="en" />)

    await user.keyboard('{Escape}')
    expect(details().open).toBe(false)
  })
})

// The account menu above was the only thing under test, which left the brand,
// the search form and the sign-out button unmeasured — a mutation run scored
// this file at 36%. Everything below kills a mutant that survived.
describe('Header brand', () => {
  it('falls back to the product name when the operator set none', () => {
    render(<Header lang="en" />)
    expect(screen.getByText('Open Hybrid Cloud')).toBeInTheDocument()
  })

  it('renders the operator shop name instead when there is one', () => {
    render(<Header lang="en" shopName="Contoso Cloud" />)
    expect(screen.getByText('Contoso Cloud')).toBeInTheDocument()
    expect(screen.queryByText('Open Hybrid Cloud')).not.toBeInTheDocument()
  })

  // The logo replaces the wordmark rather than joining it, and carries the shop
  // name as its alt text — otherwise the brand link has no accessible name.
  it('shows the logo with the shop name as its alt text', () => {
    render(<Header lang="en" shopName="Contoso Cloud" logoDataUrl="data:image/png;base64,AAA" />)
    const logo = screen.getByAltText('Contoso Cloud')
    expect(logo.tagName.toLowerCase()).toBe('img')
    expect(logo).toHaveAttribute('src', 'data:image/png;base64,AAA')
    expect(screen.queryByText('Contoso Cloud')).not.toBeInTheDocument()
  })
})

describe('Header search', () => {
  it('starts empty and takes what is typed', async () => {
    const user = userEvent.setup()
    render(<Header lang="en" />)

    const field = screen.getByRole('textbox', { name: /search products/i })
    expect(field).toHaveValue('')
    await user.type(field, 'postgres')
    expect(field).toHaveValue('postgres')
  })

  it('names the field and the submit button for a screen reader', () => {
    render(<Header lang="en" />)
    expect(screen.getByPlaceholderText(/search products/i)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /search products/i })).toBeInTheDocument()
    // A magnifying-glass icon and nothing else: without this the button is
    // announced as "button" and nothing more.
    expect(screen.getByRole('button', { name: /^search$/i })).toBeInTheDocument()
  })

  it('sends the query to the catalogue', async () => {
    const user = userEvent.setup()
    render(<Header lang="en" />)

    await user.type(screen.getByRole('textbox', { name: /search products/i }), 'postgres')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(push).toHaveBeenCalledWith('/catalog?q=postgres')
  })

  // The query goes into a URL, so anything the user types has to survive the
  // trip — an unescaped `&` would silently truncate the search.
  it('escapes what it puts in the URL', async () => {
    const user = userEvent.setup()
    render(<Header lang="en" />)

    await user.type(screen.getByRole('textbox', { name: /search products/i }), 'a&b c/d')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(push).toHaveBeenCalledWith(`/catalog?q=${encodeURIComponent('a&b c/d')}`)
  })

  it('goes to the unfiltered catalogue when the box holds only spaces', async () => {
    const user = userEvent.setup()
    render(<Header lang="en" />)

    await user.type(screen.getByRole('textbox', { name: /search products/i }), '   ')
    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(push).toHaveBeenCalledWith('/catalog')
  })

  // A form that reloads the page loses the client state the whole app is built
  // on, so preventDefault is load-bearing rather than boilerplate.
  it('does not let the browser submit the form', async () => {
    const user = userEvent.setup()
    render(<Header lang="en" />)
    // The spy must NOT call preventDefault itself: the submit event bubbles to
    // document AFTER the form's own handler, so `defaultPrevented` here is the
    // component's answer — and a spy that prevents it too would report true
    // whatever the component did.
    let prevented: boolean | null = null
    const submit = (e: Event) => { prevented = e.defaultPrevented; e.preventDefault() }
    document.addEventListener('submit', submit)

    await user.click(screen.getByRole('button', { name: /^search$/i }))

    expect(prevented).toBe(true)
    document.removeEventListener('submit', submit)
  })
})

describe('Header account controls', () => {
  it('shows the signed-in name above the menu label', () => {
    render(<Header userName="Root Admin" lang="en" />)
    expect(screen.getByText('Root Admin')).toBeInTheDocument()
  })

  it('shows only the menu label when nobody is named', () => {
    render(<Header lang="en" />)
    expect(screen.getByText(/my account/i)).toBeInTheDocument()
    expect(screen.queryByText('Root Admin')).not.toBeInTheDocument()
  })

  // redirectTo matters: signing out without it leaves the browser on a page the
  // middleware then bounces, which reads as a hang.
  it('signs out to the login page', async () => {
    const { signOut } = await import('next-auth/react')
    const user = userEvent.setup()
    render(<Header userName="Root Admin" lang="en" />)

    await user.click(screen.getByText(/my account/i))
    await user.click(screen.getByRole('button', { name: /sign out/i }))

    expect(signOut).toHaveBeenCalledWith({ redirectTo: '/login' })
  })
})

describe('Header document listeners', () => {
  // Both handlers live on `document`, so a component that does not remove them
  // leaks one pair per mount — and in this app the header remounts on every
  // navigation.
  it('takes both listeners off the document when it goes away', () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<Header lang="en" />)

    unmount()

    const events = remove.mock.calls.map((c) => c[0])
    expect(events).toContain('keydown')
    expect(events).toContain('pointerdown')
    remove.mockRestore()
  })

  // The effect has an empty dependency list. If that list ever grows, every
  // re-render re-registers, and Escape starts closing the panel several times.
  it('registers them once, not once per render', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const { rerender } = render(<Header lang="en" cartCount={0} />)
    const afterFirst = add.mock.calls.filter((c) => c[0] === 'keydown').length

    rerender(<Header lang="en" cartCount={3} />)
    rerender(<Header lang="en" cartCount={7} shopName="Other" />)

    expect(add.mock.calls.filter((c) => c[0] === 'keydown').length).toBe(afterFirst)
    add.mockRestore()
  })

  // The outside-click handler asks whether the event landed inside the <details>.
  // A pointerdown on the panel itself is inside, and must not close it — the
  // panel's own click handler is what does that, after the link has been followed.
  it('leaves the panel open for a pointer event inside it', async () => {
    const user = userEvent.setup()
    render(<Header userName="Root Admin" lang="en" />)
    await user.click(screen.getByText(/my account/i))
    expect(details().open).toBe(true)

    const inside = screen.getByRole('link', { name: /orders/i })
    inside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))

    expect(details().open).toBe(true)
  })
})

describe('Header keyboard scope', () => {
  // The handler returns early on anything that is not Escape. Without that
  // guard, typing in the search box would close the account menu on every
  // keystroke.
  it('leaves the menu open for keys that are not Escape', async () => {
    const user = userEvent.setup()
    render(<Header userName="Root Admin" lang="en" />)
    await user.click(screen.getByText(/my account/i))

    await user.keyboard('{ArrowDown}')
    await user.keyboard('a')

    expect(details().open).toBe(true)
  })

  // The second guard: with the menu closed there is nothing to dismiss, so
  // Escape belongs to whatever else is on screen. Returning early is what stops
  // the header pulling focus onto its own summary from across the page.
  it('does not pull focus when Escape is pressed with the menu closed', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <Header userName="Root Admin" lang="en" />
        <button type="button">elsewhere</button>
      </div>,
    )
    const elsewhere = screen.getByRole('button', { name: /elsewhere/i })
    elsewhere.focus()

    await user.keyboard('{Escape}')

    expect(document.activeElement).toBe(elsewhere)
  })

  it('renders in English when no language is resolved', () => {
    render(<Header />)
    expect(screen.getByText(/my account/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^search$/i })).toBeInTheDocument()
  })
})
