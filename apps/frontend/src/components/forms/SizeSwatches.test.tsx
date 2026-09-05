import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OfferingSize } from '@open-hybrid-cloud/types'
import { SizeSwatches } from './SizeSwatches'

const size = (over: Partial<OfferingSize>): OfferingSize => ({
  id: 1, code: 'S', label: 'Small', price: '10.00', currency: 'EUR', sortOrder: 0, active: true,
  ...over,
})

const sizes = [
  size({ id: 1, code: 'S', label: 'Small', price: '10.00' }),
  size({ id: 2, code: 'M', label: 'Medium', price: '20.00' }),
  size({ id: 3, code: 'XL', label: 'Extra large', price: '80.00' }),
]

describe('SizeSwatches', () => {
  // The reason it is not a dropdown: comparing what S, M and XL cost should not
  // require opening anything.
  it('shows every size and its price at once', () => {
    render(<SizeSwatches sizes={sizes} value="" onChange={() => {}} lang="en" />)

    for (const label of ['Small', 'Medium', 'Extra large']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('10.00 EUR')).toBeInTheDocument()
    expect(screen.getByText('80.00 EUR')).toBeInTheDocument()
  })

  // Native radios, so the selected state reaches assistive technology without
  // the visual treatment having to be the only signal.
  it('is a named radio group with the chosen size checked', () => {
    render(<SizeSwatches sizes={sizes} value="M" onChange={() => {}} lang="en" />)

    const group = screen.getByRole('group', { name: /size/i })
    expect(group).toBeInTheDocument()

    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(screen.getByRole('radio', { name: /medium/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /small/i })).not.toBeChecked()
  })

  it('reports the code, not the label, when one is picked', async () => {
    const onChange = vi.fn()
    render(<SizeSwatches sizes={sizes} value="" onChange={onChange} lang="en" />)

    await userEvent.click(screen.getByRole('radio', { name: /extra large/i }))

    // The code is what the order line stores and what reaches the pipeline.
    expect(onChange).toHaveBeenCalledWith('XL')
  })

  // One tab stop for the whole group, arrows within it — what a keyboard user
  // expects of a set of alternatives, and free from a real radio group.
  it('moves between sizes with the arrow keys', async () => {
    const onChange = vi.fn()
    render(<SizeSwatches sizes={sizes} value="S" onChange={onChange} lang="en" />)

    await userEvent.tab()
    expect(screen.getByRole('radio', { name: /small/i })).toHaveFocus()

    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith('M')
  })

  // Falls back to the code so a size with no label is still pickable rather than
  // rendering an empty button.
  it('shows the code when a size has no label', () => {
    render(<SizeSwatches sizes={[size({ id: 9, code: 'XXL', label: '' })]} value="" onChange={() => {}} lang="en" />)
    expect(screen.getByRole('radio', { name: /XXL/ })).toBeInTheDocument()
  })

  it('renders nothing for an offering with no sizes', () => {
    const { container } = render(<SizeSwatches sizes={[]} value="" onChange={() => {}} lang="en" />)
    expect(container).toBeEmptyDOMElement()
  })
})
