import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Input } from './Input'

describe('Input', () => {
  it('links the label to the control', () => {
    render(<Input label="Email" />)
    const input = screen.getByLabelText('Email')
    expect(input).toBeInTheDocument()
  })

  it('marks required fields with an asterisk', () => {
    render(<Input label="Name" required />)
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  it('sets aria-invalid and links the error via aria-describedby', () => {
    render(<Input label="Price" error="Too low" />)
    const input = screen.getByLabelText('Price')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('Too low')
  })

  it('does not set aria-invalid when there is no error', () => {
    render(<Input label="Ok" hint="Some hint" />)
    const input = screen.getByLabelText('Ok')
    expect(input).not.toHaveAttribute('aria-invalid')
    const describedBy = input.getAttribute('aria-describedby')
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('Some hint')
  })
})
