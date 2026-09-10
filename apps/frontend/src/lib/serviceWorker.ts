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
 * How long cache-clearing may hold up a sign-out.
 *
 * Short on purpose. Ending the session is the point; emptying the caches is
 * tidiness that matters on a shared device, and a second is far longer than
 * either operation needs when it is going to work at all.
 */
const CLEAR_BUDGET_MS = 1_000

/** Resolve when `p` does, or when the budget runs out — never reject, never hang. */
const withinBudget = async (p: Promise<unknown>): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      p,
      new Promise<void>((resolve) => { timer = setTimeout(resolve, CLEAR_BUDGET_MS) }),
    ])
  } catch {
    // Storage blocked, worker gone. Nothing here is worth failing a sign-out.
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Empty every cache, and wait for it — but never for long.
 *
 * The worker cannot see a sign-out — it is a fetch to another origin followed
 * by a client-side redirect — so the page has to say so. Awaited rather than
 * fired and forgotten, because the redirect that follows would otherwise race
 * it and the caches would survive on a shared device.
 *
 * BOUNDED, because awaiting it was how sign-out broke (#359). This used to
 * `await navigator.serviceWorker.ready`, and `ready` never settles when no
 * worker becomes active: per spec it resolves once there is an active
 * registration and it never rejects, so a failed registration left no rejection
 * for the `try` to catch and the await hung for the life of the page. The
 * `signOut()` on the next line was never reached, and the only sign-out button
 * in the app did nothing — on a shared machine, while telling the user it had.
 *
 * So the rule is now structural rather than careful: everything in here is
 * best-effort AND time-boxed, and this function always settles. Whatever it
 * could not finish, it does not get to stop the session ending.
 *
 * Both paths that end a session call this: the menu item and the 401 handler in
 * `lib/api.ts`. Adding a third without calling it is the way this regresses.
 */
export const clearServiceWorkerCaches = async (): Promise<void> => {
  if (typeof caches !== 'undefined') {
    // A browser that refuses cache access (private mode, storage blocked) has
    // nothing cached to clear. Never let this stop a sign-out.
    await withinBudget(
      caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))),
    )
  }

  const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker
  if (!container) return

  /*
   * `getRegistration()` rather than `ready`: it resolves to `undefined` when
   * there is nothing registered instead of waiting for a worker that is never
   * coming. `ready` is still awaited after that — a registration can exist
   * while its worker is only installing — but only inside the budget.
   */
  await withinBudget(
    container
      .getRegistration()
      .then((registration) => (registration ? container.ready : undefined))
      .then(() => {
        // Also tell the worker, which may hold caches this page's `caches` view
        // does not enumerate in every browser.
        container.controller?.postMessage({ type: 'isf-signout' })
      }),
  )
}
