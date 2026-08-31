'use client'

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
 * Renders nothing. The attribute is written on the element rather than kept in
 * React state so it survives the effect's own re-render and can be read by
 * anything, including a plain CSS selector.
 */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true'
    return () => {
      delete document.documentElement.dataset.hydrated
    }
  }, [])

  return null
}
