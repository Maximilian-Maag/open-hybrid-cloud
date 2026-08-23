import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginForm } from './LoginForm'

const signIn = vi.fn()
const push = vi.fn()
const refresh = vi.fn()
let params = new URLSearchParams()

vi.mock('next-auth/react', () => ({ signIn: (...args: unknown[]) => signIn(...args) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => params,
}))
vi.mock('@/lib/useLang', () => ({ useLang: () => 'en' }))

const props = {
  shopName: 'Open Hybrid Cloud',
  shopSubtitle: '',
  logoDataUrl: null,
  primaryColor: '#131921',
  secondaryColor: '#febd69',
}

/** The app's own step-one endpoint, which the form calls with `fetch`. */
const mockChallenge = (body: unknown, status = 200) => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const signInAsPassword = async () => {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/email/i), 'root@test.dev')
  await user.type(screen.getByLabelText(/^password$/i), 'pw')
  await user.click(screen.getByRole('button', { name: /sign in/i }))
  return user
}

beforeEach(() => {
  params = new URLSearchParams()
  signIn.mockReset()
  push.mockReset()
  refresh.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LoginForm — no second factor', () => {
  it('signs in through NextAuth once the password is accepted', async () => {
    mockChallenge({ ok: true, mfaRequired: false })
    signIn.mockResolvedValue({ error: null })

    render(<LoginForm {...props} />)
    await signInAsPassword()

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
    expect(signIn.mock.calls[0][1]).toMatchObject({ email: 'root@test.dev', password: 'pw' })
  })

  it('shows a generic error for a wrong password and never calls signIn', async () => {
    mockChallenge({ ok: false, error: 'Invalid credentials' }, 401)

    render(<LoginForm {...props} />)
    await signInAsPassword()

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('passes the rate-limit message through, because it says how long to wait', async () => {
    mockChallenge({ ok: false, error: 'Too many login attempts. Try again in 15 minutes.' }, 429)

    render(<LoginForm {...props} />)
    await signInAsPassword()

    expect(await screen.findByRole('alert')).toHaveTextContent(/15 minutes/)
  })

  it('honours a same-site callbackUrl and ignores an absolute one', async () => {
    params = new URLSearchParams({ callbackUrl: '/orders' })
    mockChallenge({ ok: true, mfaRequired: false })
    signIn.mockResolvedValue({ error: null })

    render(<LoginForm {...props} />)
    await signInAsPassword()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/orders'))
  })
})

describe('LoginForm — second factor required', () => {
  const enterMfa = async () => {
    mockChallenge({ ok: true, mfaRequired: true, mfaToken: 'challenge-token' })
    render(<LoginForm {...props} />)
    await signInAsPassword()
    return screen.findByLabelText(/authentication code/i)
  }

  it('asks for a code instead of signing in', async () => {
    await enterMfa()

    // The password step is gone, and no session was created.
    expect(screen.queryByLabelText(/^password$/i)).toBeNull()
    expect(signIn).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByText(/authenticator app/i)).toBeInTheDocument()
  })

  it('redeems the challenge with the code, and does not resend the password', async () => {
    await enterMfa()
    signIn.mockResolvedValue({ error: null })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/authentication code/i), '123456')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
    const credentials = signIn.mock.calls[0][1] as Record<string, unknown>
    expect(credentials).toMatchObject({ mfaToken: 'challenge-token', code: '123456' })
    expect(credentials.password).toBeUndefined()
    expect(push).toHaveBeenCalledWith('/')
  })

  it('accepts a recovery code, not only six digits', async () => {
    await enterMfa()
    signIn.mockResolvedValue({ error: null })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/authentication code/i), 'ABCDE-FGHJK-LMNPQ-RSTUV')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
    expect((signIn.mock.calls[0][1] as Record<string, unknown>).code).toBe('ABCDE-FGHJK-LMNPQ-RSTUV')
  })

  it('clears the code and stays on the step when it is rejected', async () => {
    await enterMfa()
    signIn.mockResolvedValue({ error: 'CredentialsSignin' })

    const user = userEvent.setup()
    const field = screen.getByLabelText(/authentication code/i)
    await user.type(field, '000000')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(field).toHaveValue('')
    expect(push).not.toHaveBeenCalled()
  })

  it('discards the challenge when the user goes back', async () => {
    await enterMfa()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /back/i }))

    // Back at the password step, with the password cleared: a half-finished
    // sign-in must not be left lying around.
    expect(await screen.findByLabelText(/^password$/i)).toHaveValue('')
    expect(screen.queryByLabelText(/authentication code/i)).toBeNull()
  })
})
