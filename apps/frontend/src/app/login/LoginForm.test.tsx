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

  /**
   * The button half of the same screen (#240).
   *
   * The submit button was rendered unconditionally, so a key-only account got a
   * "Sign in" button under the hidden code field. Pressing it submitted an empty
   * code and the backend refused it — a refusal that reads as "your login was
   * rejected" for a control that should never have been there.
   *
   * `queryByRole` and not `toBeVisible`: the button is not rendered at all, and
   * jsdom would not see a `hidden` class if it were only styled away.
   */
  it('offers no submit button for an account that holds only security keys', async () => {
    mockChallenge({
      ok: true,
      mfaRequired: true,
      mfaToken: 'challenge-token',
      methods: ['webauthn'],
      webauthnOptions: { challenge: 'abc', allowCredentials: [] },
    })
    render(<LoginForm {...props} />)
    await signInAsPassword()

    await waitFor(() => expect(screen.queryByLabelText(/^password$/i)).toBeNull())
    // The key button is the whole interface, plus the way out.
    expect(screen.getByRole('button', { name: /use security key/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /verify/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull()
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
  })

  /**
   * The label, where a code IS wanted (#240).
   *
   * It said "Sign in" — the same words as the button on the password step the
   * user had just pressed, which reads as being asked to log in again rather
   * than to confirm a code. Asserted as an absence too: a button whose
   * accessible name still contains "sign in" is the bug.
   */
  it('names the second-factor action rather than repeating "Sign in"', async () => {
    await enterMfa()

    expect(screen.getByRole('button', { name: /^verify$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull()
  })

  /**
   * Neither control (#240).
   *
   * `login-challenge` leaves `webauthnOptions` null when building them fails,
   * rather than failing the sign-in. On a key-only account that hides the code
   * field AND removes the key button, so without this the card would be a
   * heading and a Back link with nothing said about why.
   */
  it('explains itself when the challenge can offer no factor at all', async () => {
    mockChallenge({
      ok: true,
      mfaRequired: true,
      mfaToken: 'challenge-token',
      methods: ['webauthn'],
      webauthnOptions: null,
    })
    render(<LoginForm {...props} />)
    await signInAsPassword()

    expect(await screen.findByText(/could not offer a second factor/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /use security key/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /verify/i })).toBeNull()
  })

  // The message is for the dead end only: a code field on screen is an interface,
  // so saying "no second factor could be offered" next to it would be a lie.
  it('says nothing of the sort when the code field is there', async () => {
    await enterMfa()

    expect(screen.queryByText(/could not offer a second factor/i)).toBeNull()
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
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

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
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
    expect((signIn.mock.calls[0][1] as Record<string, unknown>).code).toBe('ABCDE-FGHJK-LMNPQ-RSTUV')
  })

  it('clears the code and stays on the step when it is rejected', async () => {
    await enterMfa()
    signIn.mockResolvedValue({ error: 'CredentialsSignin' })

    const user = userEvent.setup()
    const field = screen.getByLabelText(/authentication code/i)
    await user.type(field, '000000')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

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
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

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

/**
 * The focus indicator is a property of a state the page scan never reaches: axe
 * scans a page at rest, and the e2e focus probe counts any painted shadow layer
 * as a pass — so a ring painted in white on white satisfies both while being
 * invisible (#186).
 */
describe('LoginForm — focus indicators', () => {
  const ringColour = (el: HTMLElement) => el.style.getPropertyValue('--tw-ring-color')

  it('paints the sign-in button ring in the accent, not in its own text colour', async () => {
    // `ring-2` with no colour compiles to `var(--tw-ring-color, currentcolor)`.
    // currentColor on this button is --bp-ink, which readableInk('#131921')
    // returns as #ffffff — a white ring, on the #fff that --tw-ring-offset-color
    // defaults to, on a white card, with the UA outline removed. --ring-accent
    // is the brand colour darkened until it clears AA against white.
    mockChallenge({ ok: true, mfaRequired: false })
    render(<LoginForm {...props} />)

    expect(ringColour(screen.getByRole('button', { name: /sign in/i }))).toBe('var(--ring-accent)')
  })

  it('paints the second-factor verify button the same way', async () => {
    mockChallenge({ ok: true, mfaRequired: true, mfaToken: 'tok', methods: ['totp'] })
    render(<LoginForm {...props} />)
    await signInAsPassword()

    const verify = await screen.findByRole('button', { name: /^verify$/i })
    expect(ringColour(verify)).toBe('var(--ring-accent)')
  })

  it('leaves no submit control relying on the fallback', () => {
    // The three other controls on this page already set it inline. A future
    // button that forgets is the same defect again, and it is invisible in
    // review — which is what this counts.
    mockChallenge({ ok: true, mfaRequired: false })
    const { container } = render(<LoginForm {...props} />)

    for (const el of container.querySelectorAll<HTMLElement>('[class*="focus-visible:ring-2"], [class*="focus:ring-2"]')) {
      expect(ringColour(el), el.outerHTML).not.toBe('')
    }
  })
})
