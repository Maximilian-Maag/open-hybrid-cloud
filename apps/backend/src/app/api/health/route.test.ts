import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/bootstrap', () => ({
  runBootstrap: vi.fn().mockResolvedValue(undefined),
}))

import { GET } from './route'
import { runBootstrap } from '@/lib/bootstrap'

describe('GET /api/health', () => {
  it('returns 200 with { status: "ok" } and runs the bootstrap idempotently', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'ok' })
    expect(vi.mocked(runBootstrap)).toHaveBeenCalledTimes(1)
  })

  it('re-runs bootstrap on every call (Docker healthcheck contract)', async () => {
    await GET()
    await GET()
    // once in the previous test + twice here = 3 (order-independent check)
    expect(vi.mocked(runBootstrap).mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
