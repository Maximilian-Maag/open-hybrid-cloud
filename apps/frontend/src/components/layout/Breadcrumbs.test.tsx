import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Breadcrumbs } from './Breadcrumbs'

/**
 * The trail is the app's WCAG 2.4.8 "Location" mechanism. Two things carry that
 * meaning and neither is visible: `aria-current="page"` on the last crumb, and
 * the fact that the last crumb is NOT a link. Both are one boolean away from
 * silently disappearing.
 */

const trail = [
  { label: 'Catalog', href: '/catalog' },
  { label: 'Databases', href: '/catalog?category=db' },
  { label: 'Postgres', href: '/catalog/postgres' },
]

describe('Breadcrumbs', () => {
  it('names the navigation landmark with the passed label', () => {
    // Without its own name it reads as a second unnamed <nav> beside the main
    // one, which is exactly the bug this component replaced.
    render(<Breadcrumbs items={trail} label="Breadcrumb" />)
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
  })

  it('marks the last crumb as the current page', () => {
    render(<Breadcrumbs items={trail} label="Breadcrumb" />)
    const current = screen.getByText('Postgres')
    expect(current).toHaveAttribute('aria-current', 'page')
  })

  it('does not link the last crumb even when it carries an href', () => {
    // The page you are on is not a destination. Linking it also drops
    // aria-current, so the trail stops stating a location at all.
    render(<Breadcrumbs items={trail} label="Breadcrumb" />)
    expect(screen.queryByRole('link', { name: 'Postgres' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Catalog' })).toHaveAttribute('href', '/catalog')
    expect(screen.getByRole('link', { name: 'Databases' })).toBeInTheDocument()
  })

  it('puts aria-current on the last crumb only', () => {
    render(<Breadcrumbs items={trail} label="Breadcrumb" />)
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
  })

  it('renders a crumb without an href as plain text, not a link', () => {
    render(
      <Breadcrumbs
        items={[{ label: 'Admin' }, { label: 'Users', href: '/admin/users' }, { label: 'Ada' }]}
        label="Breadcrumb"
      />,
    )
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument()
  })

  it('does not mark an href-less intermediate crumb as the current page', () => {
    render(<Breadcrumbs items={[{ label: 'Admin' }, { label: 'Ada' }]} label="Breadcrumb" />)
    expect(screen.getByText('Admin')).not.toHaveAttribute('aria-current')
    expect(screen.getByText('Ada')).toHaveAttribute('aria-current', 'page')
  })

  it('is an ordered list, so the trail is announced as a sequence', () => {
    const { container } = render(<Breadcrumbs items={trail} label="Breadcrumb" />)
    expect(container.querySelector('ol')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('hides the separators from the accessibility tree', () => {
    // Otherwise the trail reads as "Catalog chevron Databases chevron Postgres".
    render(<Breadcrumbs items={trail} label="Breadcrumb" />)
    const separators = document.querySelectorAll('[aria-hidden="true"]')
    expect(separators).toHaveLength(2)
    for (const s of separators) expect(s.textContent).toBe('›')
  })

  it('puts no separator before the first crumb', () => {
    render(<Breadcrumbs items={trail} label="Breadcrumb" />)
    const first = screen.getAllByRole('listitem')[0]
    expect(first.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('underlines the links, so colour is not the only cue (WCAG 1.4.1)', () => {
    // The trail sits in slate text and the links are painted in the branding
    // colour, which on the default palette measures 1.03:1 against it.
    render(<Breadcrumbs items={trail} label="Breadcrumb" />)
    expect(screen.getByRole('link', { name: 'Catalog' })).toHaveClass('underline')
  })

  it('renders a single-crumb trail as the current page with no separator', () => {
    render(<Breadcrumbs items={[{ label: 'Orders', href: '/orders' }]} label="Breadcrumb" />)
    expect(screen.getByText('Orders')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0)
  })
})

// The trail sits in a line of text painted in the branding colour, so a link
// distinguished by colour alone would fail WCAG 1.4.1 — on the default palette
// the accent measures 1.03:1 against the surrounding slate. The underline is the
// non-colour signal, and the colour is the branding variable rather than a fixed
// blue, so both are behaviour.
describe('Breadcrumbs link affordance', () => {
  it('underlines the links and paints them from the branding text colour', () => {
    render(
      <Breadcrumbs
        label="Breadcrumb"
        items={[{ label: 'Catalog', href: '/catalog' }, { label: 'Postgres' }]}
      />,
    )
    const link = screen.getByRole('link', { name: 'Catalog' })
    expect(link).toHaveClass('underline')
    expect(link.style.color).toBe('var(--bp-text)')
  })

  it('keeps each crumb in its own list item', () => {
    render(
      <Breadcrumbs
        label="Breadcrumb"
        items={[{ label: 'Catalog', href: '/catalog' }, { label: 'Databases', href: '/catalog?c=1' }, { label: 'Postgres' }]}
      />,
    )
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    // The separator lives inside the item it precedes and is hidden, so the
    // trail does not read as "Catalog chevron Databases".
    for (const li of items) expect(li).toHaveClass('flex')
  })
})
