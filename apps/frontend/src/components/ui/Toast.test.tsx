import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { ToastProvider, useToast } from './Toast'

function Trigger({ type }: { type: 'success' | 'error' }) {
  const { toast } = useToast()
  return <button onClick={() => toast('Hello', type)}>fire</button>
}

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

  /**
   * WCAG 2.2.1 Timing Adjustable (#186).
   *
   * A 3.5 s auto-dismiss with no way to stop it meets none of the criterion's
   * three exceptions, and a timer is not a DOM property — no scan of a rendered
   * toast can see it, which is why this has to be asserted with fake clocks.
   */
  describe('the 3.5 s timer', () => {
    afterEach(() => vi.useRealTimers())

    it('dismisses on its own when nobody is looking', () => {
      vi.useFakeTimers()
      render(
        <ToastProvider>
          <Trigger type="success" />
        </ToastProvider>,
      )
      act(() => { screen.getByText('fire').click() })
      expect(screen.getByText('Hello')).toBeInTheDocument()

      act(() => { vi.advanceTimersByTime(3600) })
      expect(screen.queryByText('Hello')).toBeNull()
    })

    it('stops while the pointer is on it, and picks up where it left off', () => {
      vi.useFakeTimers()
      render(
        <ToastProvider>
          <Trigger type="success" />
        </ToastProvider>,
      )
      act(() => { screen.getByText('fire').click() })
      const bubble = screen.getByText('Hello').closest('[role]') as HTMLElement

      act(() => { vi.advanceTimersByTime(3000) })
      act(() => { fireEvent.pointerEnter(bubble) })

      // Ten times the remaining budget while hovered: reading a message must not
      // be a race.
      act(() => { vi.advanceTimersByTime(5000) })
      expect(screen.getByText('Hello')).toBeInTheDocument()

      // And it resumes with the 500 ms it had left, not with a fresh 3.5 s —
      // otherwise hovering repeatedly would keep a toast up for ever.
      act(() => { fireEvent.pointerLeave(bubble) })
      act(() => { vi.advanceTimersByTime(600) })
      expect(screen.queryByText('Hello')).toBeNull()
    })

    it('stops while the keyboard is inside it, so the dismiss button can be used', () => {
      vi.useFakeTimers()
      render(
        <ToastProvider>
          <Trigger type="success" />
        </ToastProvider>,
      )
      act(() => { screen.getByText('fire').click() })

      act(() => { screen.getByRole('button', { name: /dismiss/i }).focus() })
      act(() => { vi.advanceTimersByTime(10_000) })
      expect(screen.getByText('Hello')).toBeInTheDocument()
    })
  })

  it('renders the toast viewport before the app, so the dismiss button is reachable', () => {
    // The container is `fixed`, so DOM order costs nothing visually — but it used
    // to render after {children}, which put the dismiss button behind every
    // control on the page in tab order. On /admin/users that is well over the
    // 3.5 s the toast lives for.
    const { container } = render(
      <ToastProvider>
        <Trigger type="success" />
      </ToastProvider>,
    )
    act(() => { screen.getByText('fire').click() })

    const bubble = screen.getByText('Hello').closest('[role]')
    if (!bubble) throw new Error('no toast bubble')
    const trigger = screen.getByText('fire')
    expect(bubble.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container).toBeTruthy()
  })
})
