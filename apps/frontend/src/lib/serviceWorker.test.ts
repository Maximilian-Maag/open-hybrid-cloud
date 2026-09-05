import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearServiceWorkerCaches, registerServiceWorker } from './serviceWorker'

/**
 * Registering the worker, and emptying it on sign-out (#148).
 *
 * The contract is one sentence: nothing goes into a cache that a sign-out does
 * not take out again. Both paths that end a session call this — the menu item
 * and the 401 handler — and a third one added without it is how this regresses.
 */
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
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(), controller: null } })

    await clearServiceWorkerCaches()

    // A version bump or a stray cache from an older worker must go too — an
    // allowlist here would leave exactly the ones nobody remembered.
    expect(deleted.sort()).toEqual(['ohc-assets-v1', 'ohc-shell-v1', 'something-else'])
  })

  it('also tells the worker, which may hold caches this page cannot enumerate', async () => {
    stubCaches([])
    const postMessage = vi.fn()
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(), controller: { postMessage } } })

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
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(), controller: null } })

    await expect(clearServiceWorkerCaches()).resolves.toBeUndefined()
  })

  it('does not throw when there is no service worker at all', async () => {
    stubCaches(['ohc-shell-v1'])
    vi.stubGlobal('navigator', {})

    await expect(clearServiceWorkerCaches()).resolves.toBeUndefined()
  })

  it('does not throw when caches are unavailable entirely', async () => {
    vi.stubGlobal('caches', undefined)
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(), controller: null } })

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
