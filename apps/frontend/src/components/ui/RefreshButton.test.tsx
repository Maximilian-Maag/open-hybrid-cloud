import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RefreshButton } from './RefreshButton'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => refresh() }) }))
vi.mock('@/lib/useLang', () => ({ useLang: () => 'en' }))

beforeEach(() => {
  refresh.mockReset()
})

describe('RefreshButton', () => {
  it('re-fetches the page when pressed', async () => {
    render(<RefreshButton />)
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('calls router.refresh rather than reloading the window', async () => {
    // A reload would throw away client state and scroll position, and on the
    // infrastructure list it would close every disclosure the user had opened.
    const reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    })

    render(<RefreshButton />)
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }))

    expect(refresh).toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    Object.defineProperty(window, 'location', { configurable: true, value: original })
  })

  it('reports that it is working while the round trip is in flight', async () => {
    // `router.refresh()` returns void, so without the transition the button has
    // no honest pending state — and a control that reads as instant when it is
    // not is how people end up pressing it four times.
    let release: () => void = () => {}
    refresh.mockImplementation(() => {
      // Keep the transition open until the test lets it finish.
      throw new Promise<void>((resolve) => {
        release = resolve
      })
    })

    render(<RefreshButton />)
    const button = screen.getByRole('button')
    await userEvent.click(button)

    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'))
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent(/refreshing/i)
    release()
  })

  it('is an ordinary button, so it is reachable by keyboard and named', async () => {
    render(<RefreshButton />)
    const button = screen.getByRole('button', { name: /refresh/i })
    expect(button.tagName).toBe('BUTTON')

    // Enter activates a button; a div with an onClick would not.
    button.focus()
    await userEvent.keyboard('{Enter}')
    expect(refresh).toHaveBeenCalled()
  })

  it('is not busy before it is pressed', () => {
    render(<RefreshButton />)
    const button = screen.getByRole('button')
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'false')
  })
})
