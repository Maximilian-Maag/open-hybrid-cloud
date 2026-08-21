import { expiredLoginUrl } from '@/lib/session'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? ''

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

/**
 * Set once a sign-out is under way.
 *
 * A dead token fails every in-flight request at once — a page fetches half a
 * dozen things in parallel — and without this each 401 would start its own
 * sign-out and the redirects would race.
 */
let endingSession = false

/**
 * A 401 means the session is over, not that this one request was unlucky.
 *
 * Before this, every caller decided for itself: server components turned the
 * rejection into an empty list (`Promise.allSettled` → `[]`), client components
 * showed whatever error text they had, and the user sat on a page that looked
 * logged in with no data and no way out but finding the sign-out item in a menu
 * (#103).
 *
 * Only the browser acts here. On the server the middleware and the dashboard
 * layout have already made this decision, and `redirect()` from inside a fetch
 * helper would be swallowed by the very `Promise.allSettled` that hid the
 * problem in the first place.
 */
const endExpiredSession = async (): Promise<void> => {
  if (typeof window === 'undefined') return
  if (endingSession) return
  // Already on the login page: signing out again would loop.
  if (window.location.pathname === '/login') return

  endingSession = true
  // Imported here, not at module scope: this module is used by server components
  // too, and `next-auth/react` is a client library.
  const { signOut } = await import('next-auth/react')
  await signOut({ redirectTo: expiredLoginUrl(window.location.pathname) })
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
    if (res.status === 401) await endExpiredSession()
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
