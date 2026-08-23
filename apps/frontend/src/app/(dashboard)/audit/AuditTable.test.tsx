import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AuditTable } from './AuditTable'

vi.mock('@/lib/api', () => ({ get: vi.fn() }))
import { get } from '@/lib/api'

const mockGet = get as unknown as ReturnType<typeof vi.fn>

describe('AuditTable', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockGet.mockResolvedValue({ data: [], total: 0 })
  })

  it('keeps the newer page even if the older page answers later (#138)', async () => {
    // Clicking Next twice quickly fires a second `load()` before the first
    // one's request has answered. Resolve them out of order and the older
    // page — plus its `total`, which drives the Next/Previous disabled state
    // — must not overwrite what the newer request already produced.
    const entry = (id: number) => ({ id, action: 'x', createdAt: new Date().toISOString() })
    let resolvePage2: (v: { data: unknown[]; total: number }) => void = () => {}
    let resolvePage3: (v: { data: unknown[]; total: number }) => void = () => {}
    let call = 0
    mockGet.mockImplementation(() => {
      call += 1
      if (call === 1) return Promise.resolve({ data: [entry(1)], total: 45 }) // initial mount, page 1 of 3
      if (call === 2) return new Promise((resolve) => { resolvePage2 = resolve })
      return new Promise((resolve) => { resolvePage3 = resolve })
    })

    render(<AuditTable token="tok" />)
    await waitFor(() => expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument())

    const next = screen.getByRole('button', { name: 'Next' })
    fireEvent.click(next) // load() for page 2, held open
    fireEvent.click(next) // load() for page 3, held open

    // The newer request (page 3) answers first...
    resolvePage3({ data: [entry(3)], total: 45 })
    await waitFor(() => expect(screen.getByText(/page 3 of 3/i)).toBeInTheDocument())

    // ...then the stale page-2 request answers, with a `total` that would
    // otherwise change the page count shown underneath "Page 3".
    resolvePage2({ data: [entry(2)], total: 22 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText(/page 3 of 3/i)).toBeInTheDocument()
  })

  it('debounces the free-text filters instead of fetching per keystroke', async () => {
    render(<AuditTable token="tok" />)

    // Initial load.
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1))

    const input = screen.getByLabelText('Action')
    for (const v of ['c', 'cr', 'cre', 'crea', 'creat', 'create']) {
      fireEvent.change(input, { target: { value: v } })
    }

    // No request is fired synchronously per keystroke.
    expect(mockGet).toHaveBeenCalledTimes(1)

    // After the debounce window, exactly one additional request goes out with
    // the final value — not one per character.
    await waitFor(() => {
      const urls = mockGet.mock.calls.map((c) => String(c[0]))
      expect(urls.some((u) => u.includes('action=create'))).toBe(true)
    })
    expect(mockGet).toHaveBeenCalledTimes(2)
  })
})
