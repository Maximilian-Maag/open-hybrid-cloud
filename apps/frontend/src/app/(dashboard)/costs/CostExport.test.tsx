import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let currentParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useSearchParams: () => currentParams,
}))

import { CostExport } from './CostExport'

const clicked: HTMLAnchorElement[] = []
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

const renderExport = (qs = '') => {
  currentParams = new URLSearchParams(qs)
  return render(<CostExport token="test-token" lang="en" />)
}

const requestedUrl = () => (vi.mocked(fetch).mock.calls[0][0] as string)
const requestedParams = () => new URLSearchParams(requestedUrl().split('?')[1])

beforeEach(() => {
  clicked.length = 0
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
  // jsdom has no real download; capture the click instead of navigating.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this)
  })
  // A string body, not a Blob: this environment pairs jsdom's Blob with undici's
  // Response, and `new Response(jsdomBlob)` throws on the missing .stream().
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('orderId,createdAt\n', { status: 200 })),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
})

describe('CostExport', () => {
  it('sends the token in the Authorization header rather than the URL', async () => {
    const user = userEvent.setup()
    renderExport()

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
    // Keeping it out of the URL keeps it out of history and access logs.
    expect(requestedUrl()).not.toContain('test-token')
  })

  it('forwards the current filters so the file covers the reported orders', async () => {
    const user = userEvent.setup()
    renderExport('range=custom&from=2026-01-01&to=2026-03-31&projectId=10')

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())

    const params = requestedParams()
    expect(params.get('range')).toBe('custom')
    expect(params.get('from')).toBe('2026-01-01')
    expect(params.get('to')).toBe('2026-03-31')
    expect(params.get('projectId')).toBe('10')
    expect(params.get('format')).toBe('csv')
  })

  it('ignores unrelated query parameters', async () => {
    const user = userEvent.setup()
    renderExport('range=all&page=3&utm_source=email')

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())

    const params = requestedParams()
    expect(params.get('page')).toBeNull()
    expect(params.get('utm_source')).toBeNull()
  })

  it('asks for PDF from the PDF button', async () => {
    const user = userEvent.setup()
    renderExport()

    await user.click(screen.getByRole('button', { name: /export pdf/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(requestedParams().get('format')).toBe('pdf')
    expect(clicked[0].download).toBe('costs.pdf')
  })

  it('triggers a download from the response blob', async () => {
    const user = userEvent.setup()
    renderExport()

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(clicked).toHaveLength(1))
    expect(clicked[0].download).toBe('costs.csv')
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('reports a failed export instead of downloading an error page', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    )
    renderExport()

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/export failed/i)
    expect(clicked).toHaveLength(0)
  })

  it('reports a network failure', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    renderExport()

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/export failed/i)
  })

  it('re-enables the buttons after a failure so the user can retry', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    renderExport()

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: /export csv/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /export pdf/i })).toBeEnabled()
  })
})
