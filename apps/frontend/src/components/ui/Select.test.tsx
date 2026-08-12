import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Select } from './Select'

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
]

describe('Select', () => {
  it('links the label to the control and renders options', () => {
    render(<Select label="Kind" options={options} />)
    const select = screen.getByLabelText('Kind')
    expect(select.tagName).toBe('SELECT')
    expect(screen.getByRole('option', { name: 'Alpha' })).toBeInTheDocument()
  })

  it('sets aria-invalid and links the error when in error state', () => {
    render(<Select label="Kind" options={options} error="Required" />)
    const select = screen.getByLabelText('Kind')
    expect(select).toHaveAttribute('aria-invalid', 'true')
    const describedBy = select.getAttribute('aria-describedby')
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('Required')
  })
})
