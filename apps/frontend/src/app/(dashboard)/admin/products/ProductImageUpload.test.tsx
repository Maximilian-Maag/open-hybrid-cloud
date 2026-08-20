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

const fileInput = () => screen.getByLabelText(/image file/i, { selector: 'input[type="file"]' })
const altInput = () => screen.getByLabelText(/image description/i)

/** Describe the picture first — the control refuses to upload without it. */
const describeIt = async (user: ReturnType<typeof userEvent.setup>, text = 'Traffic graphs') => {
  await user.type(altInput(), text)
}

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
    await describeIt(user)

    await user.upload(fileInput(), file('p.png', 'image/png'))

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
    await describeIt(user)

    await user.upload(fileInput(), file('huge.png', 'image/png', 11 * 1024 * 1024))

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
    await describeIt(user)

    await user.upload(fileInput(), file('a.png', 'image/png'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/unsupported image type/i)
  })

  it('sends the description with the file', async () => {
    const user = userEvent.setup()
    render(<ProductImageUpload productId={7} token="t" />)
    await describeIt(user, 'Dashboard with traffic graphs')

    await user.upload(fileInput(), file('p.png', 'image/png'))
    await waitFor(() => expect(fetch).toHaveBeenCalled())

    const body = (lastCall() as [string, RequestInit])[1].body as FormData
    expect(body.get('alt')).toBe('Dashboard with traffic graphs')
  })

  it('refuses to upload an undescribed image', async () => {
    // WCAG 1.1.1: an empty alt claims the picture carries no information, and only
    // the person uploading it can make that claim.
    const user = userEvent.setup()
    render(<ProductImageUpload productId={7} token="t" />)

    await user.upload(fileInput(), file('p.png', 'image/png'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/describe what the image shows/i)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('starts from the stored description when the product already has one', () => {
    render(<ProductImageUpload productId={7} token="t" initialAlt="An existing description" />)
    expect(altInput()).toHaveValue('An existing description')
  })

  it('saves a changed description without re-uploading the file', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    render(<ProductImageUpload productId={9} token="t" initialAlt="Old" />)

    await user.clear(altInput())
    await user.type(altInput(), 'New description')
    await user.click(screen.getByRole('button', { name: /save description/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [url, init] = lastCall() as [string, RequestInit]
    expect(url).toContain('/api/admin/products/9/image')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ alt: 'New description' })
  })

  it('refuses to save an empty description', async () => {
    const user = userEvent.setup()
    render(<ProductImageUpload productId={9} token="t" initialAlt="Old" />)

    await user.clear(altInput())
    await user.click(screen.getByRole('button', { name: /save description/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/description is required/i)
    expect(fetch).not.toHaveBeenCalled()
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
    await describeIt(user)

    await user.upload(fileInput(), file('p.png', 'image/png'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/upload failed/i)
  })

  it('notifies the parent only after a successful change', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    render(<ProductImageUpload productId={7} token="t" onChanged={onChanged} />)
    await describeIt(user)

    await user.upload(fileInput(), file('p.png', 'image/png'))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))

    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 415 }))
    await user.upload(fileInput(), file('p2.png', 'image/png'))
    await screen.findByRole('alert')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })
})
