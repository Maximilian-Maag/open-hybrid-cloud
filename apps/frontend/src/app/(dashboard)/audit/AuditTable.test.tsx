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
