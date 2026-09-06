import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearServiceWorkerCaches, registerServiceWorker } from './serviceWorker'

/**
 * Registering the worker, and emptying it on sign-out (#148).
 *
 * The contract is one sentence: nothing goes into a cache that a sign-out does
 * not take out again. Both paths that end a session call this — the menu item
 * and the 401 handler — and a third one added without it is how this regresses.
 */
/**
 * A service-worker container stub.
 *
 * `getRegistration` is part of the surface now: `ready` alone was what made the
 * old tests pass while sign-out was broken in every browser (#359). Every stub
 * here resolved `ready` immediately, which is the one case where the bug does
 * not appear.
 */
const stubWorker = (over: {
  ready?: Promise<unknown>
  registration?: unknown
  controller?: { postMessage: (m: unknown) => void } | null
} = {}) =>
  vi.stubGlobal('navigator', {
    serviceWorker: {
      ready: over.ready ?? Promise.resolve(),
      getRegistration: vi.fn().mockResolvedValue('registration' in over ? over.registration : {}),
      controller: over.controller ?? null,
    },
  })

const stubCaches = (names: string[]) => {
  const deleted: string[] = []
  vi.stubGlobal('caches', {
    keys: vi.fn().mockResolvedValue(names),
    delete: vi.fn(async (n: string) => { deleted.push(n); return true }),
  })
  return deleted
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('clearServiceWorkerCaches', () => {
  it('deletes every cache, not only the shell', async () => {
    const deleted = stubCaches(['ohc-shell-v1', 'ohc-assets-v1', 'something-else'])
    stubWorker()

    await clearServiceWorkerCaches()

    // A version bump or a stray cache from an older worker must go too — an
    // allowlist here would leave exactly the ones nobody remembered.
    expect(deleted.sort()).toEqual(['ohc-assets-v1', 'ohc-shell-v1', 'something-else'])
  })

  it('also tells the worker, which may hold caches this page cannot enumerate', async () => {
    stubCaches([])
    const postMessage = vi.fn()
    stubWorker({ controller: { postMessage } })

    await clearServiceWorkerCaches()

    expect(postMessage).toHaveBeenCalledWith({ type: 'ohc-signout' })
  })

  /*
   * Every failure path below must still let the sign-out proceed. A browser
   * that refuses cache access has nothing cached to leak; one that throws here
   * and stops the redirect leaves the user signed in, which is worse.
   */
  it('does not throw when the browser refuses cache access', async () => {
    vi.stubGlobal('caches', { keys: vi.fn().mockRejectedValue(new Error('blocked')), delete: vi.fn() })
    stubWorker()

    await expect(clearServiceWorkerCaches()).resolves.toBeUndefined()
  })

  it('does not throw when there is no service worker at all', async () => {
    stubCaches(['ohc-shell-v1'])
    vi.stubGlobal('navigator', {})

    await expect(clearServiceWorkerCaches()).resolves.toBeUndefined()
  })

  /*
   * The bug (#359), and the reason this function is time-boxed rather than
   * merely wrapped in a `try`.
   *
   * `ServiceWorkerContainer.ready` resolves when a worker becomes active and
   * NEVER REJECTS. With `/sw.js` returning 404 the registration failed, no
   * worker ever activated, and the old code's `await navigator.serviceWorker
   * .ready` hung for the life of the page — with no rejection for the `try` to
   * catch. `signOut()` on the next line was never reached, so the only sign-out
   * button in the app did nothing while telling the user it had.
   */
  it('settles even when the worker never activates', async () => {
    stubCaches(['ohc-shell-v1'])
    // Never resolves, never rejects — exactly what a failed registration gives.
    stubWorker({ ready: new Promise(() => {}), registration: {} })

    await expect(clearServiceWorkerCaches()).resolves.toBeUndefined()
  })

  it('does not wait on a worker that was never registered', async () => {
    stubCaches(['ohc-shell-v1'])
    stubWorker({ ready: new Promise(() => {}), registration: undefined })

    // `getRegistration()` answers `undefined` rather than waiting for a worker
    // that is not coming, so this settles without needing the budget at all.
    await expect(clearServiceWorkerCaches()).resolves.toBeUndefined()
  })

  it('settles even when cache deletion itself hangs', async () => {
    vi.stubGlobal('caches', { keys: vi.fn(() => new Promise(() => {})), delete: vi.fn() })
    stubWorker()

    await expect(clearServiceWorkerCaches()).resolves.toBeUndefined()
  })

  it('does not throw when caches are unavailable entirely', async () => {
    vi.stubGlobal('caches', undefined)
    stubWorker()

    await expect(clearServiceWorkerCaches()).resolves.toBeUndefined()
  })
})

describe('registerServiceWorker', () => {
  it('registers the worker at the origin root, so it sees every navigation', () => {
    const register = vi.fn().mockResolvedValue({})
    vi.stubGlobal('navigator', { serviceWorker: { register } })

    registerServiceWorker()

    expect(register).toHaveBeenCalledWith('/sw.js')
  })

  it('does nothing where service workers are unsupported', () => {
    vi.stubGlobal('navigator', {})
    expect(() => registerServiceWorker()).not.toThrow()
  })

  it('does not throw when registration is rejected', async () => {
    const register = vi.fn().mockRejectedValue(new Error('insecure context'))
    vi.stubGlobal('navigator', { serviceWorker: { register } })

    expect(() => registerServiceWorker()).not.toThrow()
    await Promise.resolve()
  })
})
