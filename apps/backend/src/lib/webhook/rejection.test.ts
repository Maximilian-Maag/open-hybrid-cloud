import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { rejectCallback } from './rejection'

/**
 * Issue #211. A rejected callback used to return 401 and log nothing, which is
 * why 36 consecutive rejections on hcp-dev left no trace anywhere but the proxy
 * access log. These assert the log line exists and says the useful things —
 * because "it returns 401" was already true and was not the problem.
 */
const makeReq = (headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/webhooks/gitlab/pipeline', { method: 'POST', headers })

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  errSpy.mockRestore()
})

/** Everything the logger was handed, as one string. */
const logged = () => errSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n')

describe('rejectCallback', () => {
  it('logs the rejection, which is the whole point', () => {
    rejectCallback(makeReq(), { provider: 'gitlab', reason: 'Invalid token' })
    expect(errSpy).toHaveBeenCalled()
    expect(logged()).toMatch(/REJECTED gitlab callback: Invalid token/)
  })

  it('says what the consequence is, so the reader knows it matters', () => {
    // The order stalls permanently: nothing retries, nothing polls, and the CI
    // provider does not resend.
    rejectCallback(makeReq(), { provider: 'gitlab', reason: 'Invalid token' })
    expect(logged()).toMatch(/stay in provisioning/i)
  })

  it('names the likely cause and where to fix it', () => {
    // Whoever reads this will not have the issue open.
    rejectCallback(makeReq(), { provider: 'gitlab', reason: 'Invalid token' })
    expect(logged()).toMatch(/callback secret/i)
    expect(logged()).toMatch(/Admin → Environments/)
  })

  it('includes the pipeline id when the body identified one', () => {
    rejectCallback(makeReq(), { provider: 'github', reason: 'Invalid signature', pipelineId: '740' })
    expect(logged()).toMatch(/pipeline=740/)
  })

  it('omits the pipeline id rather than logging "undefined"', () => {
    rejectCallback(makeReq(), { provider: 'gitlab', reason: 'Missing token' })
    expect(logged()).not.toMatch(/pipeline=/)
  })

  it('never logs the presented credential', () => {
    // A secret in a log file is a secret in whatever ships that log file, and
    // knowing it was wrong is enough. The helper is not given the token at all,
    // which is the point — this pins that it stays that way.
    rejectCallback(makeReq({ 'x-gitlab-token': 'super-secret-value' }), {
      provider: 'gitlab',
      reason: 'Invalid token',
    })
    expect(logged()).not.toMatch(/super-secret-value/)
  })

  it('still answers 401 by default', () => {
    const res = rejectCallback(makeReq(), { provider: 'gitlab', reason: 'Invalid token' })
    expect(res.status).toBe(401)
  })

  it('carries the reason to the caller as well as to the log', async () => {
    const res = rejectCallback(makeReq(), { provider: 'bitbucket', reason: 'Missing signature' })
    expect(await res.json()).toEqual({ error: 'Missing signature' })
  })

  it('takes a different status when one is asked for', () => {
    const res = rejectCallback(makeReq(), { provider: 'gitlab', reason: 'Nope', status: 403 })
    expect(res.status).toBe(403)
  })
})
