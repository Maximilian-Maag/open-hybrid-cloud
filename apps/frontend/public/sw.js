/*
 * Service worker for the portal (#148).
 *
 * Hand-written, and small enough to stay that way. `next-pwa` is unmaintained
 * for the App Router and Serwist is a dependency and a build step; a shell-only
 * worker is about eighty lines, and the eighty lines are the part that has to be
 * right.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 *
 * Cache the shell. Never cache anything a session produced.
 *
 * Every dashboard page in this portal is user-scoped and role-scoped. A worker
 * that cached `/orders` and served it to the next person to sign in on the same
 * device would hand one user's orders to another — on a shared laptop, on a
 * kiosk, on a phone that changed hands. So:
 *
 *   - navigations       → network, falling back to the offline page. NEVER
 *                         cached, because HTML here is authenticated.
 *   - /api/*            → network only. Never cached, never fallen back.
 *   - /_next/static/*   → cache first. Content-hashed by the build, so a hit is
 *                         always the right bytes.
 *   - fonts, the icons  → stale-while-revalidate. Not session-scoped.
 *   - everything else   → network.
 *
 * #146 sharpens this: the backend token is deliberately kept out of the
 * browser's reach, and a cache the page can read is one more place it could end
 * up. Nothing authenticated goes in.
 *
 * Offline WRITES are out of scope and this file is where that is enforced by
 * omission: there is no Background Sync registration. An order placed in a
 * tunnel and fired twenty minutes later would hit a catalogue whose prices have
 * moved, with an approval flow that assumes the requester is there. Writes
 * require connectivity and fail loudly.
 */

// Bump to retire every previous cache. The activate handler deletes anything
// that is not this exact name, so a stale shell cannot outlive a deploy.
const VERSION = 'v1'
const SHELL = `ohc-shell-${VERSION}`
const ASSETS = `ohc-assets-${VERSION}`
const OFFLINE_URL = '/offline'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // `reload` so an install never picks the offline page out of the HTTP
      // cache — a stale one would be the thing shown at the worst moment.
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      // A failed precache must not leave a worker installed that has no
      // fallback; letting it reject keeps the previous worker in charge.
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== SHELL && n !== ASSETS).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

/** Build output, content-hashed, so a cache hit is always the right bytes. */
const isImmutable = (url) => url.pathname.startsWith('/_next/static/')

/** Not session-scoped, and worth having offline for the shell to render. */
const isRevalidatable = (url) =>
  url.pathname === '/icon.svg' ||
  url.pathname === '/icon-maskable.svg' ||
  url.pathname.startsWith('/_next/image') ||
  /\.(?:woff2?|ttf|otf)$/.test(url.pathname)

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Another origin's problem — and the backend is a different origin here
  // (:3001), so this is also what keeps every API response out of the cache
  // even before the path check below.
  if (url.origin !== self.location.origin) return

  // Authenticated JSON, and the frontend's own proxy to it. Never cached and
  // never served stale: a cached 200 from a previous session is indistinguishable
  // from a fresh one to the page reading it.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL)
        return (
          cached ??
          new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })
        )
      }),
    )
    return
  }

  if (isImmutable(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(ASSETS).then((c) => c.put(request, copy))
            }
            return res
          }),
      ),
    )
    return
  }

  if (isRevalidatable(url)) {
    event.respondWith(
      caches.match(request).then((hit) => {
        const network = fetch(request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(ASSETS).then((c) => c.put(request, copy))
            }
            return res
          })
          .catch(() => hit)
        return hit ?? network
      }),
    )
  }
})

/*
 * Sign-out empties everything.
 *
 * The page posts this because the worker cannot see a sign-out: it is a fetch
 * to another origin and then a client-side redirect. Without it a shared device
 * keeps the previous session's shell and assets — which is not a leak of
 * anything authenticated, since none of that is cached, but it is still the
 * previous operator's branding and icons sitting in a cache nobody asked to
 * keep.
 */
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'ohc-signout') return
  event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))))
})
