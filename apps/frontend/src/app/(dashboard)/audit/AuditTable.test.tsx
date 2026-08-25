import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AuditTable } from './AuditTable'

vi.mock('@/lib/api', () => ({ get: vi.fn() }))
import { get } from '@/lib/api'

const mockGet = vi.mocked(get)

describe('AuditTable', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockGet.mockResolvedValue({ data: [], total: 0 })
  })

  // #221. The failure used to be dropped: `entries` kept `[]` and the table
  // rendered "no audit entries" — which for the audit log is the wrong default.
  // "No entries match" is a statement about the record, and an administrator
  // checking who changed something reads it as evidence. An outage produced the
  // same screen as a clean record.
  it('reports a failed query instead of rendering an empty audit log', async () => {
    mockGet.mockRejectedValue(new Error('500 Internal Server Error'))

    render(<AuditTable token="t" />)

    expect(await screen.findByText('500 Internal Server Error')).toBeInTheDocument()
    expect(screen.queryByText(/no audit entries/i)).not.toBeInTheDocument()
  })

  // The point of the generation guard on the failure path, seen from the screen:
  // an operator reading page 2 whose refresh fails keeps page 2, and is told the
  // refresh failed. Replacing the rows with the error would destroy the answer
  // they were reading in order to report that it could not be re-fetched.
  it('keeps the rows already on screen when a later load fails', async () => {
    const entry = { id: 7, action: 'user.login', createdAt: new Date().toISOString() }
    let call = 0
    mockGet.mockImplementation(() => {
      call += 1
      if (call === 1) return Promise.resolve({ data: [entry], total: 1 })
      return Promise.reject(new Error('500 Internal Server Error'))
    })

    render(<AuditTable token="t" />)
    await waitFor(() => expect(screen.getByText('user.login')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'login' } })

    expect(await screen.findByText('500 Internal Server Error')).toBeInTheDocument()
    // Still there. The error is above the table, not instead of it.
    expect(screen.getByText('user.login')).toBeInTheDocument()
  })

  it('still shows the empty state when the query succeeds with nothing in it', async () => {
    mockGet.mockResolvedValue({ data: [], total: 0 })

    render(<AuditTable token="t" />)

    expect(await screen.findByText(/no audit entries/i)).toBeInTheDocument()
  })

  // The generation guard covers the failure path too: a filter change that fails
  // after a newer request has already answered must not replace the newer
  // result with an error about a query nobody is looking at any more.
  it('does not let a stale failure overwrite a newer success', async () => {
    const entry = { id: 7, action: 'user.login', createdAt: new Date().toISOString() }
    let rejectFirst: (e: Error) => void = () => {}
    let call = 0
    mockGet.mockImplementation(() => {
      call += 1
      if (call === 1) return new Promise((_resolve, reject) => { rejectFirst = reject })
      return Promise.resolve({ data: [entry], total: 1 })
    })

    render(<AuditTable token="t" />)
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1))

    // A second load — debounced, so `waitFor` covers the 300ms window — which
    // answers while the first is still held open.
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'login' } })
    await waitFor(() => expect(screen.getByText('user.login')).toBeInTheDocument())

    // Now the first, older request fails.
    rejectFirst(new Error('500 Internal Server Error'))

    await waitFor(() => expect(screen.getByText('user.login')).toBeInTheDocument())
    expect(screen.queryByText('500 Internal Server Error')).not.toBeInTheDocument()
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

  /*
   * The export refuses anything over the server's row cap with a 413 that names the
   * cap and says how to narrow the query. Showing the generic "Export failed" in its
   * place leaves the admin to retry the identical request — and, before the cap
   * refused at all, to file a silently truncated CSV as a complete export.
   */
  it('shows the server’s reason when an export is refused', async () => {
    const reason =
      'This export matches more than 50,000 entries, which is more than one export can carry. Narrow it with the from/to filters.'
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: reason }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    render(<AuditTable token="tok" />)
    await waitFor(() => expect(mockGet).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /csv/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/50,000 entries/)
    expect(alert).toHaveTextContent(/from\/to/)

    fetchSpy.mockRestore()
  })

  it('falls back to the generic message when the failure carries no reason', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('nope', { status: 500 }))

    render(<AuditTable token="tok" />)
    await waitFor(() => expect(mockGet).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /csv/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/export failed/i)

    fetchSpy.mockRestore()
  })
})
