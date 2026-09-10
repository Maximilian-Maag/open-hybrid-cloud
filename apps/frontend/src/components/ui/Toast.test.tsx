import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider, useToast } from './Toast'

function Trigger({ type }: { type: 'success' | 'error' }) {
  const { toast } = useToast()
  return <button onClick={() => toast('Hello', type)}>fire</button>
}

afterEach(() => vi.useRealTimers())

describe('Toast', () => {
  it('announces error toasts assertively via role="alert"', () => {
    render(
      <ToastProvider>
        <Trigger type="error" />
      </ToastProvider>,
    )
    act(() => { screen.getByText('fire').click() })
    const bubble = screen.getByText('Hello').closest('[role]')
    expect(bubble).toHaveAttribute('role', 'alert')
  })

  it('uses role="status" for success toasts', () => {
    render(
      <ToastProvider>
        <Trigger type="success" />
      </ToastProvider>,
    )
    act(() => { screen.getByText('fire').click() })
    const bubble = screen.getByText('Hello').closest('[role]')
    expect(bubble).toHaveAttribute('role', 'status')
  })
})

/**
 * The timer is the part no page scan can see: a rendered toast has no property
 * that says how long it has left, so every one of these is a promise only a
 * test can hold (#186).
 */
describe('Toast timing', () => {
  function raise(type: 'success' | 'error') {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Trigger type={type} />
      </ToastProvider>,
    )
    act(() => { screen.getByText('fire').click() })
  }

  it('clears a confirmation on its own', () => {
    raise('success')
    expect(screen.getByText('Hello')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(3500) })
    expect(screen.queryByText('Hello')).not.toBeInTheDocument()
  })

  it('leaves an error up until it is dismissed', () => {
    // An error is the only record of what went wrong, raised on a page the user
    // is still working on. Three and a half seconds is not long enough to read
    // it, and there is no second copy anywhere.
    raise('error')
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByText('Hello')).toBeInTheDocument()

    act(() => { screen.getByRole('button', { name: 'Dismiss' }).click() })
    expect(screen.queryByText('Hello')).not.toBeInTheDocument()
  })

  it('holds the toast open while focus is inside it', () => {
    // Reaching the dismiss button takes longer than the timer allows, so the
    // timer has to stop when the user gets there — otherwise the control is
    // gone by the time it could be pressed (WCAG 2.2.1).
    raise('success')
    act(() => { screen.getByRole('button', { name: 'Dismiss' }).focus() })
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByText('Hello')).toBeInTheDocument()

    act(() => { (screen.getByText('fire') as HTMLElement).focus() })
    act(() => { vi.advanceTimersByTime(3500) })
    expect(screen.queryByText('Hello')).not.toBeInTheDocument()
  })

  /*
   * From review. The two holds are independent inputs and used to share one
   * flag, so whichever handler fired last won: moving the pointer away while
   * focus was still on Dismiss cleared the hold and restarted the timer under
   * a keyboard user reaching for that exact button (#186).
   *
   * `fireEvent` rather than userEvent, because the point is a mouseleave with
   * focus deliberately left where it is — a real pointer move would not do
   * that, and here the unnatural combination is the bug.
   */
  it('keeps holding while focus is inside, even after the pointer leaves', () => {
    raise('success')
    const bubble = screen.getByText('Hello').closest('[role="status"]') as HTMLElement

    fireEvent.mouseEnter(bubble)
    act(() => { screen.getByRole('button', { name: 'Dismiss' }).focus() })
    fireEvent.mouseLeave(bubble)

    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('keeps holding while the pointer is over it, even after focus leaves', () => {
    raise('success')
    const bubble = screen.getByText('Hello').closest('[role="status"]') as HTMLElement

    act(() => { screen.getByRole('button', { name: 'Dismiss' }).focus() })
    fireEvent.mouseEnter(bubble)
    act(() => { (screen.getByText('fire') as HTMLElement).focus() })

    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('puts the dismiss button ahead of the page, not behind all of it', async () => {
    // The container used to render after {children}, so reaching the dismiss
    // button meant tabbing past every control on the page — well over 3.5
    // seconds on a page like /admin/users, by which time it no longer exists.
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <Trigger type="error" />
      </ToastProvider>,
    )
    await user.click(screen.getByText('fire'))
    // The click left focus on the trigger; tab order is measured from the top.
    ;(document.activeElement as HTMLElement | null)?.blur()

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss' }))
  })
})
