'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/** How often to ask the server again while something is unfinished. */
const INTERVAL_MS = 10_000

/**
 * Stop polling after this long, whatever the page still says.
 *
 * A pipeline that has not finished in twenty minutes is not going to finish on
 * the next tick, and a tab left open on it should not keep asking for the rest
 * of the afternoon. The `RefreshButton` beside this is what the reader uses
 * after that, and a reload restarts the window.
 */
const GIVE_UP_AFTER_MS = 20 * 60_000

/**
 * Re-fetch a server-rendered page while it is showing something unfinished.
 *
 * `RefreshButton` said this would not be built: *"Deliberately NOT polling. A
 * page that refreshes itself is a different feature with different costs —
 * every open tab becomes load whether anyone is looking at it — and nobody
 * asked for that."* Somebody asked (#314). The access log shows an operator
 * pressing F5 ten times in two minutes waiting for an order that finished at
 * 12:35, on a page that had no refresh control at all.
 *
 * The objection was right about the costs and wrong that they are unavoidable,
 * so each one is answered rather than accepted:
 *
 *   * `active` — the page says whether anything on it can still change. A list
 *     of finished orders polls nothing at all, which is the common case.
 *   * hidden tabs do not poll. `visibilitychange` stops the timer and a return
 *     to the tab refreshes once, immediately, because that is the moment the
 *     reader is looking.
 *   * it gives up. Twenty minutes, then the button beside it takes over.
 *
 * Renders nothing. `router.refresh()` re-runs the server component and
 * reconciles, so a disclosure the reader opened stays open and the scroll
 * position holds — which is exactly what those ten reloads threw away.
 */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter()

  // Not state: writing to it must not re-render, and the effect below reads it
  // on every tick rather than closing over the value it had when it started.
  const startedAt = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      startedAt.current = null
      return
    }
    // Restarted whenever the page comes back with something unfinished on it,
    // so a second order placed nineteen minutes in gets a full window.
    startedAt.current ??= Date.now()

    let timer: ReturnType<typeof setInterval> | null = null

    const expired = () =>
      startedAt.current !== null && Date.now() - startedAt.current >= GIVE_UP_AFTER_MS

    const stop = () => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }

    const start = () => {
      if (timer !== null || expired()) return
      timer = setInterval(() => {
        if (expired()) return stop()
        router.refresh()
      }, INTERVAL_MS)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') return stop()
      // Once on return, then resume. Coming back to a stale page and waiting
      // ten seconds for it to catch up is the same complaint in miniature.
      if (!expired()) router.refresh()
      start()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [active, router])

  return null
}
