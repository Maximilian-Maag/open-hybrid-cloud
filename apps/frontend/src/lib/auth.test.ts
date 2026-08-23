import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CredentialsSignin } from 'next-auth'
import { MFA_LOCKED_OUT } from '@/lib/loginErrors'

/**
 * `authorize` is the only place that can tell a locked-out second factor apart
 * from a wrong code, and it does so by THROWING instead of returning null.
 * It is not exported, so the only way to reach it is to capture the config
 * NextAuth is handed.
 *
 * `next-auth` is stubbed rather than partially mocked because importing it for
 * real pulls in `next/server`, which does not resolve under Vitest. The stub
 * mirrors the one thing this test depends on: `CredentialsSignin` is a class
 * whose `code` travels to the browser. In the app it is the real one — the
 * import in auth.ts is what makes the code reach `signIn(...).code`.
 */
type Authorize = (credentials: Record<string, unknown>) => Promise<unknown>

interface CredentialsProvider {
  authorize: Authorize
  /** Where `Credentials()` parks what the caller passed; the framework merges it later. */
  options?: { authorize?: Authorize }
}

const captured = vi.hoisted(() => ({ authorize: undefined as Authorize | undefined }))

vi.mock('next-auth', () => {
  class CredentialsSigninStub extends Error {
    code = 'credentials'
    static type = 'CredentialsSignin'
  }
  return {
    default: (config: { providers: CredentialsProvider[] }) => {
      const provider = config.providers[0]
      captured.authorize = provider.options?.authorize ?? provider.authorize
      return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() }
    },
    CredentialsSignin: CredentialsSigninStub,
  }
})

const mockFetch = (status: number, body: unknown = {}) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body }),
  )
}

const authorize = async (credentials: Record<string, unknown>) => {
  await import('./auth')
  if (!captured.authorize) throw new Error('the credentials provider was never registered')
  return captured.authorize(credentials)
}

const CHALLENGE = { email: 'root@test.dev', mfaToken: 'challenge', code: '000000' }

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('authorize — redeeming a second-factor challenge', () => {
  it('throws a distinct error for the lockout, so the form can say to wait', async () => {
    mockFetch(429, { error: 'Too many incorrect codes. Try again in 12 minutes.' })

    const failure = await authorize(CHALLENGE).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(CredentialsSignin)
    expect((failure as CredentialsSignin).code).toBe(MFA_LOCKED_OUT)
  })

  it('still returns null for a wrong code — only the lockout is distinguished', async () => {
    mockFetch(400, { error: 'That code is not valid.' })
    await expect(authorize(CHALLENGE)).resolves.toBeNull()
  })

  it('returns the session user when the code is accepted', async () => {
    mockFetch(200, {
      token: 'api-token',
      user: { id: 1, email: 'root@test.dev', name: 'Root', role: 'root' },
    })
    await expect(authorize(CHALLENGE)).resolves.toMatchObject({
      id: '1',
      role: 'root',
      apiToken: 'api-token',
    })
  })
})
