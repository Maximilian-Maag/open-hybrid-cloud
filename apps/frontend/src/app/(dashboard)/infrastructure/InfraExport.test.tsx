import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let currentParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useSearchParams: () => currentParams,
}))

import { InfraExport } from './InfraExport'

const clicked: HTMLAnchorElement[] = []
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

const renderExport = (qs = '') => {
  currentParams = new URLSearchParams(qs)
  return render(<InfraExport lang="en" />)
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
    vi.fn(async () => new Response('id,product\n', { status: 200 })),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
})

describe('InfraExport', () => {
  it('goes through the same-origin proxy and carries no bearer token', async () => {
    // Issue #146. The browser holds no API token at all now: the download is
    // fetched from this origin's /api/proxy, which attaches the credential
    // server-side out of the HttpOnly session cookie. Still a fetch-then-blob
    // rather than a window.open, so nothing identifying lands in the URL, in
    // history or in an access log.
    const user = userEvent.setup()
    renderExport()

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(init.headers).toBeUndefined()
    expect(requestedUrl()).toContain('/api/proxy/api/infrastructure/export')
  })

  it('forwards the current URL filters so the file matches the visible list', async () => {
    const user = userEvent.setup()
    renderExport('status=active&search=nginx&environmentId=2&sort=name&direction=asc')

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())

    const params = requestedParams()
    expect(params.get('status')).toBe('active')
    expect(params.get('search')).toBe('nginx')
    expect(params.get('environmentId')).toBe('2')
    expect(params.get('sort')).toBe('name')
    expect(params.get('direction')).toBe('asc')
    expect(params.get('format')).toBe('csv')
  })

  it('ignores unrelated query parameters', async () => {
    const user = userEvent.setup()
    renderExport('status=active&page=3&utm_source=email')

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
    expect(clicked[0].download).toBe('infrastructure.pdf')
  })

  it('only requests parameters when the box is ticked', async () => {
    const user = userEvent.setup()
    renderExport()

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(requestedParams().get('includeParameters')).toBeNull()

    vi.mocked(fetch).mockClear()
    await user.click(screen.getByLabelText(/include parameters/i))
    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(requestedParams().get('includeParameters')).toBe('true')
  })

  it('triggers a download from the response blob', async () => {
    const user = userEvent.setup()
    renderExport()

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(clicked).toHaveLength(1))
    expect(clicked[0].download).toBe('infrastructure.csv')
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
