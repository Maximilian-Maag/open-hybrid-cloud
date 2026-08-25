import { describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { CartLink, publishCartCount, CART_CHANGE_EVENT } from './CartLink'

/**
 * The badge is the only place the shopper is told the cart is not empty, and it
 * is updated by an event rather than a refetch — so "the count did not move
 * after adding an item" and "the badge is stuck on the previous page's number"
 * are both one line away.
 */

const badge = () => screen.queryByTestId('cart-count')

describe('CartLink badge', () => {
  it('shows no badge for an empty cart', () => {
    // A "0" bubble on the trolley reads as "something is waiting for you".
    render(<CartLink count={0} lang="en" />)
    expect(badge()).not.toBeInTheDocument()
  })

  it('shows the count once there is one item', () => {
    render(<CartLink count={1} lang="en" />)
    expect(badge()).toHaveTextContent('1')
  })

  it('caps the badge at 99+', () => {
    // The bubble is 16px wide; four digits break the header layout.
    render(<CartLink count={100} lang="en" />)
    expect(badge()).toHaveTextContent('99+')
  })

  it('still prints 99 exactly, not 99+', () => {
    render(<CartLink count={99} lang="en" />)
    expect(badge()).toHaveTextContent('99')
  })

  it('hides the badge from assistive tech, which reads the link name instead', () => {
    // A name that changed with the count would be re-announced on every add.
    render(<CartLink count={3} lang="en" />)
    expect(badge()).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('link', { name: 'Cart' })).toBeInTheDocument()
  })

  it('keeps the accessible name "Cart" whatever the count', () => {
    const { rerender } = render(<CartLink count={0} lang="en" />)
    expect(screen.getByRole('link', { name: 'Cart' })).toBeInTheDocument()
    rerender(<CartLink count={7} lang="en" />)
    expect(screen.getByRole('link', { name: 'Cart' })).toBeInTheDocument()
  })
})

describe('CartLink live updates', () => {
  it('adopts the count a cart mutation announces', () => {
    render(<CartLink count={1} lang="en" />)
    act(() => publishCartCount(4))
    expect(badge()).toHaveTextContent('4')
  })

  it('drops the badge when a mutation empties the cart', () => {
    render(<CartLink count={2} lang="en" />)
    act(() => publishCartCount(0))
    expect(badge()).not.toBeInTheDocument()
  })

  it('adopts a new server-rendered count on navigation', () => {
    // router.refresh() re-renders with a fresh count; without this the badge
    // keeps the number from the page you came from.
    const { rerender } = render(<CartLink count={2} lang="en" />)
    rerender(<CartLink count={5} lang="en" />)
    expect(badge()).toHaveTextContent('5')
  })

  it('removes its listener on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<CartLink count={1} lang="en" />)
    unmount()
    expect(remove).toHaveBeenCalledWith(CART_CHANGE_EVENT, expect.any(Function))
    remove.mockRestore()
  })

  it('publishes the count on the event name the header listens for', () => {
    const handler = vi.fn()
    window.addEventListener(CART_CHANGE_EVENT, handler)
    publishCartCount(9)
    window.removeEventListener(CART_CHANGE_EVENT, handler)
    expect(handler).toHaveBeenCalledTimes(1)
    expect((handler.mock.calls[0][0] as CustomEvent<number>).detail).toBe(9)
  })
})

describe('CartLink chrome', () => {
  it('points at the cart page', () => {
    render(<CartLink count={0} lang="en" />)
    expect(screen.getByRole('link', { name: 'Cart' })).toHaveAttribute('href', '/cart')
  })

  it('translates its name', () => {
    render(<CartLink count={0} lang="de" />)
    expect(screen.getByRole('link', { name: 'Warenkorb' })).toBeInTheDocument()
  })

  it('meets the 44px target floor (WCAG 2.5.5)', () => {
    // The 28px trolley in a 32px box was the smallest target in the chrome.
    render(<CartLink count={0} lang="en" />)
    expect(screen.getByRole('link', { name: 'Cart' })).toHaveClass('min-h-11')
  })
})
