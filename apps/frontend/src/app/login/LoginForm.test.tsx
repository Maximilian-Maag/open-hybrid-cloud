import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginForm } from './LoginForm'
import { MFA_LOCKED_OUT } from '@/lib/loginErrors'

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

  /**
   * A 500 is not about the credentials.
   *
   * `JWT_SECRET` under 32 characters makes every login fail with a 500 whose
   * body says the server is misconfigured — and this used to render as "invalid
   * email or password", so an operator checks the password they know is right,
   * forever. The backend logs the real reason at startup; the person in front of
   * the form never sees the log.
   */
  it('repeats a server error instead of blaming the password', async () => {
    mockChallenge(
      { ok: false, error: 'The server is misconfigured and cannot issue a session. See the server log.' },
      500,
    )

    render(<LoginForm {...props} />)
    await signInAsPassword()

    expect(await screen.findByRole('alert')).toHaveTextContent(/misconfigured/)
    expect(signIn).not.toHaveBeenCalled()
  })

  // Nothing is disclosed by admitting the server is broken: it is broken for
  // every email, including ones that do not exist. A 401 stays generic, which is
  // what stops the form being an account-existence oracle.
  it('still says nothing specific for a rejected password', async () => {
    mockChallenge({ ok: false, error: 'No user with that email' }, 401)

    render(<LoginForm {...props} />)
    await signInAsPassword()

    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent(/No user with that email/)
    expect(alert).toHaveTextContent(/invalid/i)
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

  /**
   * `methods` is how the challenge says which factors the account holds. The
   * check used to be `!data.methods || data.methods.includes('totp')`, meant to
   * treat an ABSENT list as "older backend, assume the code field" — but an
   * empty array is truthy in JavaScript, so `methods: []` fell through to
   * `[].includes('totp')`, hid the code field, and left the user at a form with
   * nothing to fill in and no way to finish signing in.
   */
  it('shows the code field when the challenge names no methods at all', async () => {
    mockChallenge({ ok: true, mfaRequired: true, mfaToken: 'challenge-token', methods: [] })
    render(<LoginForm {...props} />)
    await signInAsPassword()

    expect(await screen.findByLabelText(/authentication code/i)).toBeRequired()
  })

  it('shows the code field when an older backend omits methods', async () => {
    mockChallenge({ ok: true, mfaRequired: true, mfaToken: 'challenge-token' })
    render(<LoginForm {...props} />)
    await signInAsPassword()

    expect(await screen.findByLabelText(/authentication code/i)).toBeRequired()
  })

  it('shows the code field when the account holds a TOTP secret', async () => {
    mockChallenge({
      ok: true,
      mfaRequired: true,
      mfaToken: 'challenge-token',
      methods: ['webauthn', 'totp'],
    })
    render(<LoginForm {...props} />)
    await signInAsPassword()

    expect(await screen.findByLabelText(/authentication code/i)).toBeRequired()
  })

  // The one case that SHOULD hide it: a key-only account has no code to type,
  // and a required field it cannot fill would block the form.
  it('hides the code field for an account that holds only security keys', async () => {
    mockChallenge({
      ok: true,
      mfaRequired: true,
      mfaToken: 'challenge-token',
      methods: ['webauthn'],
    })
    render(<LoginForm {...props} />)
    await signInAsPassword()

    await waitFor(() => expect(screen.queryByLabelText(/^password$/i)).toBeNull())
    // The input stays in the DOM — it is wrapped in a `hidden` div rather than
    // unmounted, so the browser keeps the form's shape — and jsdom applies no
    // Tailwind, so `toBeVisible()` cannot see that. What IS conditional is the
    // hint above it and the `required` attribute on the field, and `required` is
    // the one that matters: a required invisible input is a form the browser
    // refuses to submit without saying why.
    expect(screen.getByLabelText(/authentication code/i)).not.toBeRequired()
    expect(screen.queryByText(/code from your authenticator app/i)).toBeNull()
  })

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

  it('says to wait or use a recovery code when the factor is locked out', async () => {
    await enterMfa()
    // What NextAuth gives the browser for a thrown CredentialsSignin: the same
    // generic error as a wrong code, plus the code that tells them apart.
    signIn.mockResolvedValue({ error: 'CredentialsSignin', code: MFA_LOCKED_OUT })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/authentication code/i), '000000')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/locked/i)
    expect(alert).toHaveTextContent(/recovery codes/i)
    expect(alert).not.toHaveTextContent(/invalid/i)
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
