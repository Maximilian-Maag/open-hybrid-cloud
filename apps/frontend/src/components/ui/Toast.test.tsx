import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
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
})
