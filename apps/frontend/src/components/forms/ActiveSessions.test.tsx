import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import userEvent from '@testing-library/user-event'
import type { SessionInfo } from '@open-hybrid-cloud/types'
import { ActiveSessions } from './ActiveSessions'

/**
 * The session card (issue #37).
 *
 * What matters here is not the markup but the two decisions the component makes
 * on its own: the current session gets a label and no button, and after a
 * revocation the list comes from the server rather than being spliced locally.
 */

const session = (over: Partial<SessionInfo>): SessionInfo => ({
  id: 1,
  userId: 1,
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0.0.0 Safari/537.36',
  createdAt: '2026-08-20T09:00:00.000Z',
  lastSeenAt: '2026-08-21T11:30:00.000Z',
  expiresAt: '2026-08-21T17:00:00.000Z',
  current: false,
  ...over,
})

const here = session({ id: 1, current: true })
const phone = session({
  id: 2,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605.1.15',
  ip: '198.51.100.4',
})

const jsonResponse = (body: unknown) =>
  // A string body, not a Blob: jsdom's Blob has no .stream(), which undici's
  // Response needs.
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('ActiveSessions', () => {
  it('labels the current session and gives it no sign-out button', async () => {
    // Offering "sign out" on the row you are sitting in reads as a way to log
    // yourself out — that is what the menu item is for — and clicking it would
    // 401 the page out from under the user with no explanation.
    render(<ActiveSessions initialSessions={[here, phone]} />)

    expect(screen.getByText('This device')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: /^Sign out:/ })
    expect(buttons).toHaveLength(1)
    expect(buttons[0].getAttribute('aria-label')).toContain('198.51.100.4')
  })

  it('names each row in the button\'s accessible name, not just "Sign out"', () => {
    render(<ActiveSessions initialSessions={[here, phone]} />)
    expect(screen.getByRole('button', { name: /Safari · iOS/ })).toBeTruthy()
  })

  it('revokes one session and takes the new list from the server', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if ((init?.method ?? 'GET') === 'DELETE') return jsonResponse({ revoked: 1 })
      expect(url).toContain('/api/sessions')
      return jsonResponse([here])
    })

    render(<ActiveSessions initialSessions={[here, phone]} />)
    await userEvent.click(screen.getByRole('button', { name: /^Sign out:/ }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Sign out:/ })).toBeNull()
    })
    // DELETE for the row, then a GET for the fresh list.
    expect(fetchMock.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method ?? 'GET'))
      .toEqual(['DELETE', 'GET'])
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/sessions/2')
  })

  it('offers "sign out everywhere else" only while there is somewhere else', () => {
    const { unmount } = render(<ActiveSessions initialSessions={[here, phone]} />)
    expect(screen.getByRole('button', { name: 'Sign out everywhere else' })).toBeTruthy()
    unmount()

    render(<ActiveSessions initialSessions={[here]} />)
    expect(screen.queryByRole('button', { name: 'Sign out everywhere else' })).toBeNull()
  })

  it('ends the other sessions in one call', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (_input, init) =>
      (init?.method ?? 'GET') === 'DELETE' ? jsonResponse({ revoked: 2 }) : jsonResponse([here]),
    )

    render(<ActiveSessions initialSessions={[here, phone, session({ id: 3 })]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere else' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Sign out everywhere else' })).toBeNull()
    })
    // The collection endpoint, not one call per row: which sessions count as
    // "everywhere else" is the server's decision, including the one to keep.
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/sessions$/)
  })

  it('shows the failure instead of pretending the session ended', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 }),
    )

    render(<ActiveSessions initialSessions={[here, phone]} />)
    await userEvent.click(screen.getByRole('button', { name: /^Sign out:/ }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Session not found')
    })
    // And the row is still there, because it is still a live session.
    expect(screen.getByRole('button', { name: /^Sign out:/ })).toBeTruthy()
  })

  it('reads an unknown ip or user agent as "not recorded", not as a blank cell', () => {
    // Both columns are nullable: no trusted proxy, or a client that sends no
    // User-Agent. An empty cell would read as a bug.
    render(<ActiveSessions initialSessions={[session({ ip: null, userAgent: null })]} />)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('fetches on mount when no list was handed to it', async () => {
    // The admin dialog's case: it was not open when the page rendered, so there is
    // nothing a server-side fetch could have pre-loaded.
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse([phone]))

    render(<ActiveSessions userId={77} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /^Sign out:/ })).toBeTruthy())
    expect(String(fetchMock.mock.calls[0][0])).toContain('userId=77')
  })

  it('does not fetch on mount when a list was handed to it', () => {
    // The settings page's case: the server already fetched it, and a second
    // request on hydration would be an audit entry per page load for nothing.
    const fetchMock = vi.spyOn(global, 'fetch')
    render(<ActiveSessions initialSessions={[here]} />)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a failed initial load instead of showing an empty list', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    )
    render(<ActiveSessions userId={5} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Forbidden'))
  })

  it('scopes every call to the user whose sessions these are', async () => {
    // Root looking at somebody else. Without the query parameter the DELETE would
    // sign root out of their own other sessions instead.
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (_input, init) =>
      (init?.method ?? 'GET') === 'DELETE' ? jsonResponse({ revoked: 1 }) : jsonResponse([]),
    )

    render(<ActiveSessions userId={77} initialSessions={[phone]} />)
    await userEvent.click(screen.getByRole('button', { name: /^Sign out:/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(String(fetchMock.mock.calls[1][0])).toContain('userId=77')
  })

  /*
   * #195, F5. These timestamps are server-rendered through `initialSessions` and
   * formatted with `toLocaleString`, which reads the runtime's time zone — Node's
   * on the server, the viewer's in the browser. Any viewer outside the server's
   * zone got a hydration mismatch and a timestamp that changed after load.
   *
   * The first render must therefore not contain a formatted time; the one after
   * mount must.
   */
  it('formats timestamps only once the browser has taken over', async () => {
    render(<ActiveSessions initialSessions={[phone]} />)

    // After mount the effect has run, so the real time is in.
    await waitFor(() => {
      const formatted = new Date(phone.lastSeenAt).toLocaleString('en')
      expect(screen.getByText(formatted)).toBeTruthy()
    })
  })

  it('renders a placeholder rather than a server-zone time on the first paint', () => {
    // `renderToString` is the server's view: no effects run, so `hydrated` is
    // false and no locale formatting can have happened. Asserting on the absence
    // of the formatted string is what catches a regression here — a re-added
    // `toLocaleString` in the render body would put it back.
    const html = renderToString(<ActiveSessions initialSessions={[phone]} />)
    expect(html).not.toContain(new Date(phone.lastSeenAt).toLocaleString('en'))
    expect(html).toContain('—')
  })
})
