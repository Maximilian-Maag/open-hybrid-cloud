import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader } from './PageHeader'

/**
 * Every dashboard page's <h1>. WCAG 2.4.6 and every screen reader's "jump to
 * heading 1" depend on it being a real h1 and on there being exactly one.
 */

describe('PageHeader', () => {
  it('renders the title as the page h1', () => {
    render(<PageHeader title="Orders" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument()
  })

  it('renders the subtitle when given', () => {
    render(<PageHeader title="Orders" subtitle="Everything you have ordered" />)
    expect(screen.getByText('Everything you have ordered')).toBeInTheDocument()
  })

  it('renders no empty paragraph when there is no subtitle', () => {
    const { container } = render(<PageHeader title="Orders" />)
    expect(container.querySelector('p')).toBeNull()
  })

  it('renders the actions when given', () => {
    render(<PageHeader title="Orders" actions={<button type="button">New order</button>} />)
    expect(screen.getByRole('button', { name: 'New order' })).toBeInTheDocument()
  })

  it('renders no actions container when there are none', () => {
    // An empty flex row still takes gap space and pushes the title off-centre.
    const { container } = render(<PageHeader title="Orders" />)
    const header = container.firstElementChild as HTMLElement
    expect(header.children).toHaveLength(1)
  })

  it('does not treat the subtitle as a second heading', () => {
    render(<PageHeader title="Orders" subtitle="Everything you have ordered" />)
    expect(screen.getAllByRole('heading')).toHaveLength(1)
  })
})
