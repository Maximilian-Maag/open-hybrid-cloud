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
      // The existing window plus the 09:00-for-an-hour default.
      windows: [
        { startMinute: 480, durationMinutes: 120 },
        { startMinute: 540, durationMinutes: 60 },
      ],
    })
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
