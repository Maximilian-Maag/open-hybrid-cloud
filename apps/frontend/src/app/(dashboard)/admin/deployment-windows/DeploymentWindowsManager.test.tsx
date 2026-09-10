import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/lib/api', () => ({ get: vi.fn(), put: vi.fn() }))

import { DeploymentWindowsManager } from './DeploymentWindowsManager'
import { get, put } from '@/lib/api'

const mockedGet = vi.mocked(get)
const mockedPut = vi.mocked(put)

/**
 * Root defining when provisioning may run (#330).
 *
 * The component's own decisions, not its markup: minutes are stored and clock
 * times are shown, the whole set is sent on save, and a rejection comes back in
 * the server's words — it is the only thing that knows which two windows
 * overlap.
 */
beforeEach(() => {
  vi.resetAllMocks()
  mockedGet.mockResolvedValue({ timeZone: 'Europe/Berlin', windows: [{ startMinute: 480, durationMinutes: 120 }] })
  mockedPut.mockResolvedValue({ timeZone: 'Europe/Berlin', windows: [{ startMinute: 480, durationMinutes: 120 }] })
})

describe('DeploymentWindowsManager', () => {
  it('shows the stored minutes as a clock time and the span they cover', async () => {
    render(<DeploymentWindowsManager />)

    // 480 is 08:00, and 08:00 for 120 minutes is 08:00–10:00. Neither number
    // means anything to a reader on its own.
    expect(await screen.findByDisplayValue('08:00')).toBeInTheDocument()
    expect(screen.getByText('08:00–10:00')).toBeInTheDocument()
  })

  it('sends the whole set, as minutes, when root saves', async () => {
    const user = userEvent.setup()
    render(<DeploymentWindowsManager />)
    await screen.findByDisplayValue('08:00')

    await user.click(screen.getByRole('button', { name: /add window/i }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(mockedPut).toHaveBeenCalled())
    expect(mockedPut).toHaveBeenCalledWith('/api/admin/deployment-windows', {
      timeZone: 'Europe/Berlin',
      // 08:00–10:00 already exists, so the new row starts at 10:00 rather than
      // at a fixed 09:00 — see below.
      windows: [
        { startMinute: 480, durationMinutes: 120 },
        { startMinute: 600, durationMinutes: 60 },
      ],
    })
  })

  /*
   * The default has to respect the rest of the set.
   *
   * `Add window` used to append a fixed 09:00–10:00. With an 08:00–10:00 window
   * already there, that overlaps, and the save came back 400 "two windows
   * overlap" — the button that is meant to be the easy path producing an error
   * the user did not ask for.
   */
  it('adds a window that does not overlap one already there', async () => {
    const user = userEvent.setup()
    mockedGet.mockResolvedValue({
      timeZone: 'UTC',
      windows: [{ startMinute: 9 * 60, durationMinutes: 60 }],
    })
    render(<DeploymentWindowsManager />)
    await screen.findByDisplayValue('09:00')

    await user.click(screen.getByRole('button', { name: /add window/i }))

    // 09:00 is taken, so the next free WORKING hour is offered — not 00:00,
    // which scanning from midnight would have produced.
    expect(await screen.findByDisplayValue('10:00')).toBeInTheDocument()
    expect(screen.getByText('09:00–10:00')).toBeInTheDocument()
  })

  it('removes a window without touching the others', async () => {
    const user = userEvent.setup()
    mockedGet.mockResolvedValue({
      timeZone: 'UTC',
      windows: [{ startMinute: 480, durationMinutes: 60 }, { startMinute: 780, durationMinutes: 90 }],
    })
    render(<DeploymentWindowsManager />)
    await screen.findByDisplayValue('08:00')

    await user.click(screen.getAllByRole('button', { name: /remove/i })[0])
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(mockedPut).toHaveBeenCalled())
    expect(mockedPut).toHaveBeenCalledWith('/api/admin/deployment-windows', {
      timeZone: 'UTC',
      windows: [{ startMinute: 780, durationMinutes: 90 }],
    })
  })

  /*
   * A window being TYPED can cross midnight even though a saved one cannot —
   * `validateWindows` and the table's CHECK both refuse those. Treated as a
   * single linear interval, 23:30–01:30 leaves 00:00 looking free, and `Add
   * window` would offer a slot underneath it.
   */
  it('does not offer a slot underneath a window that runs past midnight', async () => {
    const user = userEvent.setup()
    mockedGet.mockResolvedValue({
      // Every working hour taken, plus one running to 01:30 the next day.
      timeZone: 'UTC',
      windows: [
        { startMinute: 9 * 60, durationMinutes: 15 * 60 - 30 },
        { startMinute: 23 * 60 + 30, durationMinutes: 120 },
      ],
    })
    render(<DeploymentWindowsManager />)
    await screen.findByDisplayValue('23:30')

    await user.click(screen.getByRole('button', { name: /add window/i }))

    // 00:00 and 01:00 are under the midnight-crossing window; 02:00 is the
    // first hour genuinely free.
    expect(await screen.findByDisplayValue('02:00')).toBeInTheDocument()
  })

  /*
   * An empty set is a real answer, not a mistake: it turns the restriction off.
   * A component that refused to save it would leave root unable to undo.
   */
  it('can save an empty set', async () => {
    const user = userEvent.setup()
    mockedPut.mockResolvedValue({ timeZone: 'Europe/Berlin', windows: [] })
    render(<DeploymentWindowsManager />)
    await screen.findByDisplayValue('08:00')

    await user.click(screen.getByRole('button', { name: /remove/i }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(mockedPut).toHaveBeenCalled())
    expect(mockedPut).toHaveBeenCalledWith('/api/admin/deployment-windows', {
      timeZone: 'Europe/Berlin',
      windows: [],
    })
    expect(await screen.findByText(/no windows defined/i)).toBeInTheDocument()
  })

  // The server is the only thing that knows which two windows overlap, so its
  // sentence is the one shown rather than a generic failure.
  it('shows the server’s rejection verbatim', async () => {
    const user = userEvent.setup()
    mockedPut.mockRejectedValue(new Error('Two windows overlap; merge them or move one'))
    render(<DeploymentWindowsManager />)
    await screen.findByDisplayValue('08:00')

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByText(/two windows overlap/i)).toBeInTheDocument()
  })
})
