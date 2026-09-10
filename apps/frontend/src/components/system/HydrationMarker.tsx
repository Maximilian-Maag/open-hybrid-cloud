'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Mark the document once React has taken over from the server-rendered HTML.
 *
 * A Next.js `<Link>` looks identical before and after hydration: the anchor is
 * in the server HTML, so it is visible, enabled and clickable by every measure
 * Playwright has — and clicking it before the router is mounted follows nothing
 * at all. The same is true of any button whose handler is a client component's.
 *
 * That is why e2e tests that only ever ran against an empty database started
 * failing the moment there was data to click on: `locator.click()` succeeded and
 * the page simply stayed where it was (#152).
 *
 * The alternatives were worse. Retrying every click until the effect appears
 * makes each call site carry the workaround and hides a real regression as a
 * slow pass; navigating by `href` only works for links, not for the comment box
 * or the pipeline-stack dialog. One attribute, set once, gives every test a
 * thing to wait for — and it is useful in the browser too, where "is this page
 * live yet?" is otherwise guesswork.
 *
 * The path is stamped alongside it, and that is not decoration. Next preserves
 * the root layout across a client-side navigation, so a marker set once and
 * never cleared is still `true` on the page the router moved to — a test that
 * waits for it after a click waits for nothing, and gets an answer about the
 * page it came from. `data-hydrated-path` changes with the route, so "hydrated
 * on the page I am now looking at" becomes something a test can actually ask.
 *
 * This component is rendered AFTER `{children}` in the root layout for the same
 * reason. React runs effects in tree order, so a sibling that comes later runs
 * its effect after the page's components have run theirs — which is the moment
 * the stamp is meant to describe.
 *
 * Renders nothing. The attributes are written on the element rather than kept in
 * React state so they survive the effect's own re-render and can be read by
 * anything, including a plain CSS selector.
 */
export function HydrationMarker() {
  const pathname = usePathname()

  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true'
    document.documentElement.dataset.hydratedPath = pathname
    return () => {
      delete document.documentElement.dataset.hydrated
      delete document.documentElement.dataset.hydratedPath
    }
  }, [pathname])

  return null
}
