import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { CountUp } from './CountUp'

/**
 * The animated KPI figures on the dashboard. Two failure modes matter and
 * neither shows up in a screenshot: the number never reaching the real value
 * (so the dashboard reports something false and stays there), and the animation
 * frame not being cancelled (so a navigation leaves a loop setting state on an
 * unmounted tree, and two mounts race each other's numbers).
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
})
afterEach(() => vi.useRealTimers())

/** Advance past the animation and flush every queued frame. */
function runAnimation(ms = 1000) {
  act(() => { vi.advanceTimersByTime(ms) })
}

describe('CountUp', () => {
  it('lands exactly on the target value', () => {
    // Rounding or easing that stops short leaves the dashboard displaying a
    // number that is not the number.
    const { container } = render(<CountUp value={4200} />)
    runAnimation()
    expect(container.textContent).toBe('4200')
  })

  it('starts from zero rather than flashing the final value', () => {
    const { container } = render(<CountUp value={4200} />)
    expect(container.textContent).toBe('0')
  })

  it('never overshoots the target part-way through', () => {
    // `Math.min(progress, 1)` is the only thing stopping the eased curve from
    // running past 100% on a late frame.
    const { container } = render(<CountUp value={100} duration={100} />)
    act(() => { vi.advanceTimersByTime(50) })
    expect(Number(container.textContent)).toBeLessThanOrEqual(100)
    runAnimation()
    expect(container.textContent).toBe('100')
  })

  it('climbs towards the target instead of jumping', () => {
    const { container } = render(<CountUp value={1000} duration={800} />)
    act(() => { vi.advanceTimersByTime(16) })
    const first = Number(container.textContent)
    act(() => { vi.advanceTimersByTime(300) })
    const later = Number(container.textContent)
    expect(first).toBeLessThan(1000)
    expect(later).toBeGreaterThan(first)
  })

  it('shows a true zero immediately, with no animation to run', () => {
    const { container } = render(<CountUp value={0} />)
    expect(container.textContent).toBe('0')
    runAnimation()
    expect(container.textContent).toBe('0')
  })

  it('re-animates to a new value when the data refreshes', () => {
    const { container, rerender } = render(<CountUp value={10} duration={100} />)
    runAnimation()
    expect(container.textContent).toBe('10')
    rerender(<CountUp value={99} duration={100} />)
    runAnimation()
    expect(container.textContent).toBe('99')
  })

  it('honours a shorter duration', () => {
    const { container } = render(<CountUp value={500} duration={50} />)
    act(() => { vi.advanceTimersByTime(60) })
    expect(container.textContent).toBe('500')
  })

  it('cancels its animation frame on unmount', () => {
    // Without the cleanup the loop keeps calling setDisplay after the component
    // is gone.
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const { unmount } = render(<CountUp value={5000} duration={5000} />)
    act(() => { vi.advanceTimersByTime(16) })
    unmount()
    expect(cancel).toHaveBeenCalled()
    cancel.mockRestore()
  })

  it('cancels the previous animation before starting a new one', () => {
    // Two loops writing to the same state make the figure jitter between the
    // old and the new target.
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const { rerender } = render(<CountUp value={1000} duration={5000} />)
    act(() => { vi.advanceTimersByTime(16) })
    cancel.mockClear()
    rerender(<CountUp value={2000} duration={5000} />)
    expect(cancel).toHaveBeenCalled()
    cancel.mockRestore()
  })
  // Every test above mounts at t=0, where `now - start` and `now + start` are
  // the same arithmetic and the difference between them is invisible. Mounting
  // on a clock that has already run apart tells them apart: with a sign error
  // the first frame computes a progress far past 1, `Math.min` clamps it, and
  // the figure snaps to the target instead of counting up to it.
  it('measures elapsed time, not the time of day', () => {
    act(() => { vi.advanceTimersByTime(60_000) })
    const { container } = render(<CountUp value={1000} duration={800} />)

    act(() => { vi.advanceTimersByTime(16) })

    expect(Number(container.textContent)).toBeLessThan(1000)
  })

  // `Math.min(…, 1)` caps progress AT one, so a loop that continues while
  // progress is one keeps asking for frames after the number has arrived — for
  // as long as the dashboard stays open, on every tile.
  it('stops asking for frames once it has arrived', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const { container } = render(<CountUp value={42} duration={100} />)
    runAnimation()
    expect(container.textContent).toBe('42')

    raf.mockClear()
    act(() => { vi.advanceTimersByTime(1000) })

    expect(raf).not.toHaveBeenCalled()
    raf.mockRestore()
  })
})
