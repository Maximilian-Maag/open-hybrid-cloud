import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { AutoRefresh } from './AutoRefresh'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

/** Put the tab in a state and tell the listeners, the way a browser would. */
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  refresh.mockReset()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AutoRefresh', () => {
  it('re-fetches while something is unfinished', () => {
    render(<AutoRefresh active />)

    vi.advanceTimersByTime(25_000)

    expect(refresh).toHaveBeenCalledTimes(2)
  })

  /*
   * The cost `RefreshButton`'s doc objected to — "every open tab becomes load
   * whether anyone is looking at it". A page of finished orders is the common
   * case and it must cost nothing at all.
   */
  it('does nothing at all when the page has nothing to wait for', () => {
    render(<AutoRefresh active={false} />)

    vi.advanceTimersByTime(120_000)

    expect(refresh).not.toHaveBeenCalled()
  })

  it('stops while the tab is hidden', () => {
    render(<AutoRefresh active />)
    vi.advanceTimersByTime(10_000)
    expect(refresh).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    vi.advanceTimersByTime(60_000)

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  // Coming back to a stale page and waiting ten seconds for it to catch up is
  // the same complaint in miniature.
  it('catches up at once when the tab comes back', () => {
    render(<AutoRefresh active />)
    setVisibility('hidden')
    vi.advanceTimersByTime(60_000)
    expect(refresh).not.toHaveBeenCalled()

    setVisibility('visible')

    expect(refresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  /*
   * A pipeline that has not finished in twenty minutes will not finish on the
   * next tick, and a forgotten tab should not keep asking all afternoon.
   */
  it('gives up after twenty minutes', () => {
    render(<AutoRefresh active />)

    vi.advanceTimersByTime(20 * 60_000)
    const atTheLimit = refresh.mock.calls.length
    vi.advanceTimersByTime(10 * 60_000)

    expect(atTheLimit).toBe(119)
    expect(refresh).toHaveBeenCalledTimes(atTheLimit)
  })

  it('leaves no timer behind when it unmounts', () => {
    const { unmount } = render(<AutoRefresh active />)

    unmount()
    vi.advanceTimersByTime(60_000)

    expect(refresh).not.toHaveBeenCalled()
  })
})
