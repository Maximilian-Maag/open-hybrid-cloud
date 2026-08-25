import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Role } from '@open-hybrid-cloud/types'

let pathname = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

import { TopNav } from './TopNav'

/**
 * Two things here are worth a test. The role gate decides whether a plain user
 * is shown the approvals queue, the audit log and the admin area — a link they
 * cannot use, advertising an area they are not in. And `isActive` decides which
 * pill carries `aria-current="page"`, which is the only non-colour signal of
 * where you are.
 */

function renderNav(role: Role, path = '/') {
  pathname = path
  return render(<TopNav role={role} lang="en" />)
}

const linkNames = () => screen.getAllByRole('link').map((l) => l.textContent)

describe('TopNav role gate', () => {
  it('shows a plain user the six shared sections and nothing more', () => {
    renderNav('user')
    expect(linkNames()).toEqual(['Home', 'Catalog', 'Orders', 'Projects', 'Infrastructure', 'Costs'])
  })

  it('does not link a plain user to approvals, audit or admin', () => {
    renderNav('user')
    expect(screen.queryByRole('link', { name: 'Approvals' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Audit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
  })

  it('gives an admin approvals and audit but not the admin area', () => {
    renderNav('admin')
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Audit' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
  })

  it('gives root every section including the admin area', () => {
    renderNav('root')
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Audit' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Admin' })).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(9)
  })
})

describe('TopNav current-page marking', () => {
  it('marks Home current only on the root path', () => {
    renderNav('user', '/')
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  })

  it('does not mark Home current on every other page', () => {
    // Home is matched exactly. A prefix match on "/" makes every path in the app
    // start with it, so Home would be current everywhere and two pills would
    // claim the location at once.
    renderNav('user', '/catalog')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Catalog' })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps the section current on its detail pages', () => {
    // /orders/42 is still "Orders". An exact match would drop the marking as
    // soon as you opened anything.
    renderNav('user', '/orders/42')
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page')
  })

  it('marks exactly one link as current', () => {
    renderNav('root', '/infrastructure/abc')
    const current = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current.map((l) => l.textContent)).toEqual(['Infrastructure'])
  })

  it('marks nothing current on a path outside the nav', () => {
    renderNav('user', '/cart')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(0)
  })

  it('gives the current pill a different class from the resting ones', () => {
    // aria-current is the signal for assistive tech; the visible signal must not
    // be colour alone, so the active pill also changes weight and background.
    renderNav('user', '/costs')
    const active = screen.getByRole('link', { name: 'Costs' })
    const resting = screen.getByRole('link', { name: 'Catalog' })
    expect(active.className).not.toBe(resting.className)
    expect(active).toHaveClass('brand-state-active')
    expect(resting).toHaveClass('brand-state')
    expect(resting).not.toHaveClass('brand-state-active')
  })

  // navLinkClass takes `exact` separately from the aria-current call beside it,
  // and defaults it to false. If that default ever flips, aria-current keeps
  // saying "you are here" on a detail page while the pill stops looking like it
  // — the two signals disagree, and the visible one is the wrong one.
  it('keeps the pill marked on a detail page, not just the section root', () => {
    renderNav('user', '/orders/42')
    const orders = screen.getByRole('link', { name: 'Orders' })
    expect(orders).toHaveAttribute('aria-current', 'page')
    expect(orders).toHaveClass('brand-state-active')
    expect(orders).not.toHaveClass('brand-state')
  })

  it('sizes every pill to the 44px target floor (WCAG 2.5.5)', () => {
    renderNav('root', '/')
    for (const link of screen.getAllByRole('link')) expect(link).toHaveClass('min-h-11')
  })
})

describe('TopNav labels', () => {
  it('names the navigation landmark and translates the links', () => {
    pathname = '/'
    render(<TopNav role="user" lang="de" />)
    expect(screen.getByRole('navigation', { name: 'Hauptnavigation' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Katalog' })).toBeInTheDocument()
  })
})
