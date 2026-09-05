/**
 * Registering the worker, and emptying its caches on sign-out (#148).
 *
 * Both live here because they are two halves of one contract: nothing goes into
 * a cache that a sign-out does not take out again.
 */

/** Where the worker lives. Scoped to the origin, so it sees every navigation. */
const SW_URL = '/sw.js'

export const registerServiceWorker = (): void => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  void navigator.serviceWorker.register(SW_URL).catch(() => {
    /* the app works without it, and the browser has already logged the reason */
  })
}

/**
 * Empty every cache, and wait for it.
 *
 * The worker cannot see a sign-out — it is a fetch to another origin followed
 * by a client-side redirect — so the page has to say so. Awaited rather than
 * fired and forgotten, because the redirect that follows would otherwise race
 * it and the caches would survive on a shared device.
 *
 * Both paths that end a session call this: the menu item and the 401 handler in
 * `lib/api.ts`. Adding a third without calling it is the way this regresses.
 */
export const clearServiceWorkerCaches = async (): Promise<void> => {
  if (typeof caches !== 'undefined') {
    try {
      const names = await caches.keys()
      await Promise.all(names.map((n) => caches.delete(n)))
    } catch {
      // A browser that refuses cache access (private mode, storage blocked)
      // has nothing cached to clear. Never let this stop a sign-out.
    }
  }

  // Also tell the worker, which may hold caches this page's `caches` view does
  // not enumerate in every browser.
  try {
    await navigator.serviceWorker?.ready
    navigator.serviceWorker?.controller?.postMessage({ type: 'ohc-signout' })
  } catch {
    // No worker, or it never activated. Nothing to tell.
  }
}
