import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from './Card'

/**
 * Card is the surface almost every dashboard panel sits on. Its title is
 * rendered as a real heading, which puts it in the document outline a screen
 * reader navigates by — so "the title turned into a styled div" is an
 * accessibility regression, not a cosmetic one.
 */

describe('Card', () => {
  it('renders its children', () => {
    render(<Card>body</Card>)
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('renders the title as a heading, not just bold text', () => {
    render(<Card title="Recent orders">body</Card>)
    expect(screen.getByRole('heading', { name: 'Recent orders' })).toBeInTheDocument()
  })

  it('puts the title at level 2 by default', () => {
    // The page's own <h1> is the only heading above a card on every screen that
    // uses one. This was a hardcoded <h3>, so all 24 PageHeader pages went
    // h1 → h3 and skipped a level — `heading-order`, which the e2e gate did not
    // ask axe for until #185.
    render(<Card title="Recent orders">body</Card>)
    expect(screen.getByRole('heading', { level: 2, name: 'Recent orders' })).toBeInTheDocument()
  })

  it('takes a deeper level for a card nested under a section heading', () => {
    render(<Card title="Recent orders" level={3}>body</Card>)
    expect(screen.getByRole('heading', { level: 3, name: 'Recent orders' })).toBeInTheDocument()
  })

  it('draws no header bar when there is no title', () => {
    // An empty bordered strip above the content is what an unguarded header
    // renders as.
    render(<Card>body</Card>)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('renders the action beside the title', () => {
    render(<Card title="Recent orders" action={<button type="button">Refresh</button>}>body</Card>)
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })

  it('keeps the card chrome when a caller passes className', () => {
    // The prop appends; replacing the base classes strips the border, the
    // rounding and the white background from every card that customises width.
    const { container } = render(<Card className="col-span-2">body</Card>)
    const card = container.firstElementChild as HTMLElement
    expect(card).toHaveClass('col-span-2')
    expect(card).toHaveClass('rounded-xl')
    expect(card).toHaveClass('bg-white')
  })

  it('needs no className to render a well-formed card', () => {
    const { container } = render(<Card>body</Card>)
    expect(container.firstElementChild).toHaveClass('border')
  })
})
