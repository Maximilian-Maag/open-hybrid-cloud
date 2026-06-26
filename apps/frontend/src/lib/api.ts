const API_URL = process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? 'http://localhost:3001'

type RequestOptions = {
  method?: string
  body?: unknown
  token?: string
  isFormData?: boolean
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const apiRequest = async <T>(
  path: string,
  { method = 'GET', body, token, isFormData = false }: RequestOptions = {},
): Promise<T> => {
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (body && !isFormData) headers['Content-Type'] = 'application/json'

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(res.status, err.error ?? res.statusText)
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

export const get = <T>(path: string, token?: string) =>
  apiRequest<T>(path, { token })

export const post = <T>(path: string, body: unknown, token?: string) =>
  apiRequest<T>(path, { method: 'POST', body, token })

export const put = <T>(path: string, body: unknown, token?: string) =>
  apiRequest<T>(path, { method: 'PUT', body, token })

export const del = <T>(path: string, token?: string) =>
  apiRequest<T>(path, { method: 'DELETE', token })
