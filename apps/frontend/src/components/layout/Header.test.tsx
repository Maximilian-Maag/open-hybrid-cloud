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
