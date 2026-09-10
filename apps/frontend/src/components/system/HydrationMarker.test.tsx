import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { HydrationMarker } from './HydrationMarker'

let pathname = '/orders'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

describe('HydrationMarker', () => {
  it('marks the document once React has taken over', () => {
    pathname = '/orders'
    render(<HydrationMarker />)

    expect(document.documentElement.dataset.hydrated).toBe('true')
  })

  /*
   * The reason the path is there at all.
   *
   * Next preserves the root layout across a client-side navigation, so a marker
   * that is only ever set once is still `true` on the page the router moved to.
   * A test waiting for it after a click gets an immediate answer about the page
   * it came from, which is worse than no wait, because it reads as a guarantee.
   */
  it('re-points at the page the router moved to', () => {
    pathname = '/orders'
    const { rerender } = render(<HydrationMarker />)
    expect(document.documentElement.dataset.hydratedPath).toBe('/orders')

    pathname = '/orders/42'
    rerender(<HydrationMarker />)

    expect(document.documentElement.dataset.hydratedPath).toBe('/orders/42')
  })

  it('takes both marks away when it unmounts', () => {
    pathname = '/catalog'
    const { unmount } = render(<HydrationMarker />)

    unmount()

    expect(document.documentElement.dataset.hydrated).toBeUndefined()
    expect(document.documentElement.dataset.hydratedPath).toBeUndefined()
  })
})
