'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SessionInfo, RevokeSessionsResponse } from '@open-hybrid-cloud/types'
import { del, get } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Table } from '@/components/ui/Table'
import { useLang } from '@/lib/useLang'
import { t } from '@/lib/i18n'

/**
 * The session list, and the two ways to end one (issue #37).
 *
 * Rendered on the settings page from a server-side fetch, so the first paint has
 * the real list rather than a spinner. After a revocation it re-fetches instead of
 * splicing the row out locally: "sign out everywhere else" changes several rows at
 * once, and the server is the only thing that knows which.
 *
 * The current session is labelled and has no button. Offering "sign out" on the
 * row you are sitting in reads as a way to log yourself out, which is what the
 * menu item is for, and clicking it here would 401 the page out from under you
 * with no explanation.
 */

interface Props {
  token: string
  /**
   * The list to render immediately. Omit it and the component fetches on mount
   * instead — which is right inside a dialog that was not open when the page
   * rendered, and wrong on the settings page, where a server-side fetch means the
   * first paint already has the real list.
   */
  initialSessions?: SessionInfo[]
  /** Whose sessions these are. Omitted means the caller's own. */
  userId?: number
}

/**
 * A User-Agent as something a person can recognise.
 *
 * Deliberately shallow: the point is "is this my phone or not", and a full
 * UA-parsing library for one table column is not worth the dependency. The raw
 * string is kept as the title so nothing is actually hidden.
 */
const describeDevice = (userAgent: string | null): string => {
  if (!userAgent) return '—'
  const os =
    /Windows/i.test(userAgent) ? 'Windows'
    : /Android/i.test(userAgent) ? 'Android'
    : /iPhone|iPad|iOS/i.test(userAgent) ? 'iOS'
    : /Mac OS X|Macintosh/i.test(userAgent) ? 'macOS'
    : /Linux/i.test(userAgent) ? 'Linux'
    : null
  const browser =
    /Edg\//i.test(userAgent) ? 'Edge'
    : /OPR\/|Opera/i.test(userAgent) ? 'Opera'
    : /Chrome\//i.test(userAgent) ? 'Chrome'
    : /Safari\//i.test(userAgent) ? 'Safari'
    : /Firefox\//i.test(userAgent) ? 'Firefox'
    : null
  if (browser && os) return `${browser} · ${os}`
  return browser ?? os ?? userAgent.slice(0, 40)
}

export function ActiveSessions({ token, initialSessions, userId }: Props) {
  const lang = useLang()
  const [sessions, setSessions] = useState<SessionInfo[]>(initialSessions ?? [])
  const [busy, setBusy] = useState<number | 'others' | null>(null)
  const [loading, setLoading] = useState(initialSessions === undefined)
  const [error, setError] = useState<string | null>(null)

  const query = userId === undefined ? '' : `?userId=${userId}`

  // Fetches and returns; it does not set state. Every caller decides whether the
  // component is still mounted before it writes — an unmount mid-flight otherwise
  // means a setState on a dead component, and this card is opened in a modal that
  // is closed by clicking away from it.
  const fetchSessions = useCallback(
    () => get<SessionInfo[]>(`/api/sessions${query}`, token),
    [query, token],
  )

  useEffect(() => {
    if (initialSessions !== undefined) return
    let live = true
    fetchSessions()
      .then((rows) => { if (live) setSessions(rows) })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : t('unexpectedError', lang))
      })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
    // `initialSessions` is a mount-time decision, not something to react to: a
    // parent that re-renders with a new array must not restart the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSessions])

  const run = async (key: number | 'others', action: () => Promise<RevokeSessionsResponse>) => {
    setBusy(key)
    setError(null)
    try {
      await action()
      setSessions(await fetchSessions())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unexpectedError', lang))
    } finally {
      setBusy(null)
    }
  }

  const others = sessions.filter((s) => !s.current)

  const columns = [
    {
      header: t('device', lang),
      render: (row: SessionInfo) => (
        <span title={row.userAgent ?? undefined}>
          {describeDevice(row.userAgent)}
          {row.current && (
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {t('currentSession', lang)}
            </span>
          )}
        </span>
      ),
    },
    {
      header: t('ipAddress', lang),
      render: (row: SessionInfo) => row.ip ?? '—',
    },
    {
      header: t('lastSeen', lang),
      render: (row: SessionInfo) => new Date(row.lastSeenAt).toLocaleString(lang),
    },
    {
      header: t('created', lang),
      render: (row: SessionInfo) => new Date(row.createdAt).toLocaleString(lang),
    },
    {
      header: t('signOut', lang),
      render: (row: SessionInfo) =>
        row.current ? null : (
          <Button
            variant="danger"
            size="sm"
            disabled={busy !== null}
            // The visible label is one word on every row, so the accessible name
            // has to say WHICH row — otherwise a screen-reader user hears "sign
            // out" five times with no way to tell them apart.
            aria-label={`${t('signOut', lang)}: ${describeDevice(row.userAgent)}${row.ip ? ` (${row.ip})` : ''}`}
            onClick={() =>
              run(row.id, () => del<RevokeSessionsResponse>(`/api/sessions/${row.id}`, token))
            }
          >
            {busy === row.id ? t('loading', lang) : t('signOut', lang)}
          </Button>
        ),
    },
  ]

  return (
    <Card
      title={t('activeSessions', lang)}
      action={
        others.length > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onClick={() => run('others', () => del<RevokeSessionsResponse>(`/api/sessions${query}`, token))}
          >
            {busy === 'others'
              ? t('loading', lang)
              : /* When root is looking at someone else's sessions the backend
                   spares nothing — including the one they are using — so
                   "everywhere else" would name the wrong action. */
                t(userId === undefined ? 'signOutOthers' : 'revokeAllSessions', lang)}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{t('activeSessionsSubtitle', lang)}</p>
        {error && <Alert>{error}</Alert>}
        <Table
          columns={columns}
          data={sessions}
          emptyMessage={loading ? t('loading', lang) : t('noActiveSessions', lang)}
        />
      </div>
    </Card>
  )
}
