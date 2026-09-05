import { describe, it, expect, vi, afterEach } from 'vitest'
import { triggerFailure, MAX_LOGGED_BODY_BYTES } from './triggerError'

const res = (status: number, body: string) => new Response(body, { status })

afterEach(() => vi.restoreAllMocks())

describe('triggerFailure', () => {
  it('keeps the provider body out of the thrown message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = await triggerFailure('trigger', res(422, 'TF_VAR_api_key=sup3rs3cret'))
    expect(error.message).toBe('trigger failed: 422')
    expect(error.message).not.toContain('sup3rs3cret')
  })

  it('logs a short body whole', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await triggerFailure('trigger', res(500, 'boom'))
    expect(spy.mock.calls[0][1]).toBe('boom')
  })

  it('caps the logged body by UTF-8 bytes, not by String.length', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // '😀' is 2 UTF-16 code units and 4 UTF-8 bytes. Enough of them to pass the
    // cap in bytes while String.length is only half of it — which is exactly the
    // case a `body.length` check waves through.
    const body = '😀'.repeat(MAX_LOGGED_BODY_BYTES)
    expect(body.length).toBeLessThan(Buffer.byteLength(body, 'utf8'))

    await triggerFailure('trigger', res(500, body))
    const logged = spy.mock.calls[0][1] as string

    const [shown] = logged.split('… [')
    expect(Buffer.byteLength(shown, 'utf8')).toBeLessThanOrEqual(MAX_LOGGED_BODY_BYTES)
    expect(logged).toContain(`[${Buffer.byteLength(body, 'utf8')} bytes, truncated]`)
    // A character cut in half decodes to U+FFFD; it must not be logged.
    expect(shown.endsWith('�')).toBe(false)
  })
})
