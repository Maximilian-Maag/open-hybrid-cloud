import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { db } from '@/lib/db/client'
import { ciSources } from '@/lib/db/schema'
import { INSECURE_TRANSPORT_FLAG } from '@/lib/ci/transport'
import { reportInsecureCiSources } from './index'

/**
 * The boot-time notice for a deployment #329 has just broken.
 *
 * Refusing at the point of the call is right, but on an existing deployment an
 * `http://` GitLab keeps looking fine in the admin UI and fails only when
 * somebody places an order — as a provisioning error nobody connects to an
 * upgrade. This says it once, at boot, naming the source and the switch.
 */
const before = process.env[INSECURE_TRANSPORT_FLAG]
let stderr: MockInstance<(...args: unknown[]) => void>

beforeEach(() => {
  delete process.env[INSECURE_TRANSPORT_FLAG]
  stderr = vi.spyOn(console, 'error').mockImplementation(() => {}) as unknown as MockInstance<(...args: unknown[]) => void>
})
afterEach(() => {
  if (before === undefined) delete process.env[INSECURE_TRANSPORT_FLAG]
  else process.env[INSECURE_TRANSPORT_FLAG] = before
  // Restored, not just re-spied: `vi.spyOn` on an already-spied method hands
  // back the SAME mock, so without this every assertion also sees the previous
  // test's output and three of these passed for the wrong reason.
  vi.restoreAllMocks()
})

const said = () => stderr.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n')

describe('reportInsecureCiSources', () => {
  it('names an http source, its URL and the switch', async () => {
    await db.insert(ciSources).values({
      name: 'On-Prem GitLab',
      url: 'http://gitlab.internal.example.com',
      accessToken: 'token',
      provider: 'gitlab',
    })

    await reportInsecureCiSources()

    expect(said()).toContain('On-Prem GitLab')
    expect(said()).toContain('http://gitlab.internal.example.com')
    // Without the switch the operator's only move is guesswork.
    expect(said()).toContain(INSECURE_TRANSPORT_FLAG)
  })

  it('says nothing about an https source', async () => {
    await db.insert(ciSources).values({
      name: 'SaaS GitLab',
      url: 'https://gitlab.example.com',
      accessToken: 'token',
      provider: 'gitlab',
    })

    await reportInsecureCiSources()

    expect(stderr).not.toHaveBeenCalled()
  })

  it('says nothing about loopback — that is the e2e WireMock', async () => {
    await db.insert(ciSources).values({
      name: 'WireMock',
      url: 'http://localhost:8080',
      accessToken: 'token',
      provider: 'gitlab',
    })

    await reportInsecureCiSources()

    expect(stderr).not.toHaveBeenCalled()
  })

  it('says nothing once the operator has accepted the risk', async () => {
    process.env[INSECURE_TRANSPORT_FLAG] = '1'
    await db.insert(ciSources).values({
      name: 'On-Prem GitLab',
      url: 'http://gitlab.internal.example.com',
      accessToken: 'token',
      provider: 'gitlab',
    })

    await reportInsecureCiSources()

    // Repeating a warning the operator has explicitly answered is how a log
    // stops being read.
    expect(stderr).not.toHaveBeenCalled()
  })

  it('counts every affected source, not just the first', async () => {
    await db.insert(ciSources).values([
      { name: 'A', url: 'http://a.example.com', accessToken: 't', provider: 'gitlab' },
      { name: 'B', url: 'http://b.example.com', accessToken: 't', provider: 'gitlab' },
      { name: 'C', url: 'https://c.example.com', accessToken: 't', provider: 'gitlab' },
    ])

    await reportInsecureCiSources()

    expect(said()).toContain('2 CI source(s)')
    expect(said()).toContain('A')
    expect(said()).toContain('B')
    expect(said()).not.toContain('c.example.com')
  })
})
