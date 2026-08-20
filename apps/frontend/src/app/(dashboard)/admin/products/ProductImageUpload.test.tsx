import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductImageUpload } from './ProductImageUpload'

const file = (name: string, type: string, sizeBytes = 1024) => {
  const f = new File(['x'.repeat(16)], name, { type })
  // jsdom takes File.size from the content; override it to test the size guard
  // without allocating megabytes.
  Object.defineProperty(f, 'size', { value: sizeBytes })
  return f
}

const lastCall = () => vi.mocked(fetch).mock.calls[vi.mocked(fetch).mock.calls.length - 1]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ mime: 'image/png' }), { status: 200 })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ProductImageUpload', () => {
  it('uploads the chosen file as multipart with the bearer token', async () => {
    const user = userEvent.setup()
    render(<ProductImageUpload productId={7} token="test-token" />)

    await user.upload(screen.getByLabelText(/image/i, { selector: 'input[type="file"]' }), file('p.png', 'image/png'))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [url, init] = lastCall() as [string, RequestInit]
    expect(url).toContain('/api/admin/products/7/image')
    expect(init.method).toBe('PUT')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
    // multipart, not base64 JSON: the endpoint reads formData()
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('image')).toBeInstanceOf(File)
  })

  it('refuses a file over 10 MB without uploading it', async () => {
    const user = userEvent.setup()
    render(<ProductImageUpload productId={7} token="t" />)

    await user.upload(
      screen.getByLabelText(/image/i, { selector: 'input[type="file"]' }),
      file('huge.png', 'image/png', 11 * 1024 * 1024),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(/11\.0 MB/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("shows the server's reason when it refuses the file", async () => {
    // Named and typed as a PNG so it passes the input's `accept` filter — which
    // is exactly how a file reaches the server and fails there: `accept` goes by
    // the declared type, the server goes by the bytes.
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unsupported image type — allowed: image/png' }), { status: 415 }),
    )
    render(<ProductImageUpload productId={7} token="t" />)

    await user.upload(screen.getByLabelText(/image/i, { selector: 'input[type="file"]' }), file('a.png', 'image/png'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/unsupported image type/i)
  })

  it('removes the image with a DELETE', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    render(<ProductImageUpload productId={12} token="t" />)

    await user.click(screen.getByRole('button', { name: /remove image/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [url, init] = lastCall() as [string, RequestInit]
    expect(url).toContain('/api/admin/products/12/image')
    expect(init.method).toBe('DELETE')
  })

  it('reports a network failure instead of looking successful', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    render(<ProductImageUpload productId={7} token="t" />)

    await user.upload(screen.getByLabelText(/image/i, { selector: 'input[type="file"]' }), file('p.png', 'image/png'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/upload failed/i)
  })

  it('notifies the parent only after a successful change', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    render(<ProductImageUpload productId={7} token="t" onChanged={onChanged} />)

    await user.upload(screen.getByLabelText(/image/i, { selector: 'input[type="file"]' }), file('p.png', 'image/png'))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))

    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 415 }))
    await user.upload(screen.getByLabelText(/image/i, { selector: 'input[type="file"]' }), file('p2.png', 'image/png'))
    await screen.findByRole('alert')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })
})
