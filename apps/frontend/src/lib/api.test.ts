import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError, apiRequest, get, post, put, del } from './api'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockClear()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const makeResponse = (
  body: unknown,
  status = 200,
  contentType = 'application/json',
): Response => {
  const json = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(json, {
    status,
    headers: { 'content-type': contentType },
  })
}

describe('ApiError', () => {
  it('extends Error with a status property', () => {
    const err = new ApiError(404, 'Not found')
    expect(err).toBeInstanceOf(Error)
    expect(err.status).toBe(404)
    expect(err.message).toBe('Not found')
  })
})

describe('apiRequest', () => {
  it('returns parsed JSON on success', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ id: 1, name: 'test' }))
    const result = await apiRequest<{ id: number; name: string }>('/test')
    expect(result).toEqual({ id: 1, name: 'test' })
  })

  it('throws ApiError with status on 4xx response', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ error: 'Not found' }, 404))
    const err = await apiRequest('/missing').catch((e) => e) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(404)
    expect(err.message).toBe('Not found')
  })

  it('throws ApiError on 500', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ error: 'Server error' }, 500))
    const err = await apiRequest('/fail').catch((e) => e) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(500)
    expect(err.message).toBe('Server error')
  })

  it('returns undefined for 204 No Content', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const result = await apiRequest('/empty')
    expect(result).toBeUndefined()
  })

  it('sends Authorization header when token is provided', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({}))
    await apiRequest('/secured', { token: 'my-jwt-token' })
    const [, init] = mockFetch.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer my-jwt-token',
    })
  })

  it('sets Content-Type for JSON body', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({}))
    await apiRequest('/submit', { method: 'POST', body: { key: 'val' } })
    const [, init] = mockFetch.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({
      'Content-Type': 'application/json',
    })
  })

  it('does not set Content-Type for FormData body', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({}))
    const form = new FormData()
    form.append('file', 'data')
    await apiRequest('/upload', { method: 'POST', body: form, isFormData: true })
    const [, init] = mockFetch.mock.calls[0]
    expect((init as RequestInit & { headers?: Record<string, string> }).headers?.['Content-Type']).toBeUndefined()
  })

  it('uses fallback error message when response body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }))
    const err = await apiRequest('/bad').catch((e) => e) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(503)
  })
})

describe('convenience helpers', () => {
  it('get() calls apiRequest with GET method', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: true }))
    const result = await get<{ ok: boolean }>('/items', 'token')
    expect(result.ok).toBe(true)
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: 'GET' })
  })

  it('post() sends body as JSON', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ created: true }))
    await post('/items', { name: 'new' }, 'token')
    const [, init] = mockFetch.mock.calls[0]
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).body).toBe(JSON.stringify({ name: 'new' }))
  })

  it('put() sends body with PUT method', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({}))
    await put('/items/1', { name: 'updated' })
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: 'PUT' })
  })

  it('del() sends DELETE request', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await del('/items/1', 'token')
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
  })
})
