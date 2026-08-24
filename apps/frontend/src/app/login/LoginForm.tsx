'use client'

import { useState, type FormEvent } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLang } from '@/lib/useLang'
import { t } from '@/lib/i18n'
import { Alert } from '@/components/ui/Alert'
import { readableInk, readableAccent, AA_LARGE, AA_NON_TEXT } from '@/lib/contrast'
import { MFA_LOCKED_OUT } from '@/lib/loginErrors'

interface Props {
  shopName: string
  shopSubtitle: string
  logoDataUrl: string | null
  primaryColor: string
  secondaryColor: string
}

/**
 * Where to go after signing in.
 *
 * The middleware has always put a `callbackUrl` on its redirect and nothing ever
 * read it, so an expired session dropped you on the dashboard root instead of the
 * page you were on (#103). Only same-site paths are honoured: an absolute URL or
 * a protocol-relative `//host` in a query parameter is an open redirect.
 */
const safeCallbackUrl = (value: string | null): string =>
  value && value.startsWith('/') && !value.startsWith('//') ? value : '/'

export function LoginForm({ shopName, shopSubtitle, logoDataUrl, primaryColor, secondaryColor }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const lang = useLang()
  const sessionExpired = searchParams.get('expired') === '1'
  const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  /**
   * The challenge from step one, held only in component state.
   *
   * Not in `sessionStorage` or a query parameter: it is a five-minute bearer
   * credential for finishing a sign-in, and the page it is needed on is the page
   * that received it. A reload starting over from the password is the correct
   * outcome, not a bug to work around.
   */
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [code, setCode] = useState('')

  const finishSignIn = async (result: { error?: string | null; code?: string } | undefined) => {
    if (result?.error) return false
    router.push(callbackUrl)
    router.refresh()
    return true
  }

  /**
   * Step one: check the password and find out whether a code is needed.
   *
   * This goes through the app's own route handler rather than `signIn`, because
   * `signIn` can only answer yes or no — a sign-in that needs a second factor
   * would come back as the same error as a wrong password, and the form could
   * never know to ask for a code. See app/api/login-challenge/route.ts.
   */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/login-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // "Remember me" is sent with the PASSWORD, not with the code: the
        // backend seals it into the challenge, so a two-step sign-in gets the
        // lifetime the user actually asked for without the second step being
        // able to change it (#37).
        body: JSON.stringify({ email, password, rememberMe }),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; mfaRequired?: boolean; mfaToken?: string; error?: string }
        | null

      if (!res.ok || !data?.ok) {
        // The backend's own message for a rate-limited attempt says how long to
        // wait, which is worth more than a generic failure; anything else is
        // deliberately just "invalid credentials", so this cannot be used to
        // find out which accounts exist.
        setError(res.status === 429 && data?.error ? data.error : t('invalidCredentials', lang))
        return
      }

      if (data.mfaRequired && data.mfaToken) {
        setMfaToken(data.mfaToken)
        setCode('')
        return
      }

      // No second factor: sign in the ordinary way. `rememberMe` is sent as a
      // string because NextAuth credentials are form fields (#37).
      const result = await signIn('credentials', {
        email,
        password,
        rememberMe: String(rememberMe),
        redirect: false,
      })
      if (!(await finishSignIn(result))) {
        setError(t('invalidCredentials', lang))
      }
    } catch {
      setError(t('unexpectedError', lang))
    } finally {
      setLoading(false)
    }
  }

  /** Step two: redeem the challenge with a TOTP code or a recovery code. */
  async function handleCodeSubmit(e: FormEvent) {
    e.preventDefault()
    if (!mfaToken) return
    setError(null)
    setLoading(true)
    try {
      const result = await signIn('credentials', { email, mfaToken, code, redirect: false })
      if (!(await finishSignIn(result))) {
        // The lockout is the one failure worth distinguishing: it is the
        // difference between "try again" and "stop trying and use a recovery
        // code". Everything else stays generic on purpose.
        setError(
          result?.code === MFA_LOCKED_OUT
            ? t('twoFactorLockedOut', lang)
            : t('invalidCredentials', lang),
        )
        setCode('')
      }
    } catch {
      setError(t('unexpectedError', lang))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-slate-100 px-4"
      style={{
        '--bp': primaryColor,
        '--bs': secondaryColor,
        '--bp-ink': readableInk(primaryColor).ink,
        '--bs-ink': readableInk(secondaryColor).ink,
        // The brand colour used AS text on a white card — darkened until it
        // clears readableAccent's default target (7:1), so a pale brand stays
        // readable.
        '--bp-text': readableAccent(primaryColor),
        // Same boundary as the dashboard gives its filled controls.
        '--bs-edge': readableAccent(secondaryColor, undefined, AA_NON_TEXT),
        // Focus rings sit on the white card, so they need the same treatment.
        '--ring-accent': readableAccent(secondaryColor, '#ffffff', AA_LARGE),
      } as React.CSSProperties}
    >
      {/* A real <main>. The login page renders outside the dashboard layout, so
          it had no landmark at all: `landmark-one-main` failed and `region`
          reported the title block, both form rows and the "stay signed in" row
          as content nobody could jump to. Both rules are best-practice-only,
          which is why a page the whole product funnels through was never
          checked for either. */}
      <main className="w-full max-w-sm">
        <div className="text-center mb-8">
          {logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoDataUrl} alt={shopName} className="h-12 mx-auto mb-4 object-contain" />
          ) : null}
          <h1 className="text-2xl font-bold text-slate-900">{shopName}</h1>
          {shopSubtitle && <p className="text-sm text-slate-600 mt-1">{shopSubtitle}</p>}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          {error && (
            <Alert className="mb-4">
              {error}
            </Alert>
          )}

          {/* Why you are looking at this page. Suppressed once there is an error
              from this attempt — that one is about what just happened. */}
          {sessionExpired && !error && (
            <Alert tone="info" className="mb-4">
              {t('sessionExpired', lang)}
            </Alert>
          )}

          {mfaToken ? (
            <form onSubmit={handleCodeSubmit} className="space-y-4">
              <h2 className="text-base font-semibold text-slate-900">{t('twoFactorAuth', lang)}</h2>
              <p className="text-sm text-slate-600">{t('twoFactorLoginHint', lang)}</p>
              <div>
                <label htmlFor="code" className="block text-sm font-medium text-slate-700 mb-1">
                  {t('twoFactorCodeLabel', lang)}
                </label>
                <input
                  id="code"
                  name="code"
                  type="text"
                  // one-time-code lets a phone offer the code from its keychain;
                  // the field also has to accept a 23-character recovery code,
                  // so it is not numeric-only.
                  autoComplete="one-time-code"
                  inputMode="text"
                  spellCheck={false}
                  autoCapitalize="characters"
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full min-h-11 rounded-md border border-slate-200 px-3 py-2 text-sm tracking-widest text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:border-transparent"
                  style={{ '--tw-ring-color': 'var(--ring-accent)' } as React.CSSProperties}
                  placeholder="123456"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-11 rounded-md px-4 py-2.5 text-sm font-semibold hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                style={{
                  backgroundColor: 'var(--bp)',
                  color: 'var(--bp-ink)',
                  // See the note on the sign-in button below: --tw-ring-color
                  // falls back to currentcolor, which on this button is
                  // --bp-ink — white on the shipped default primary.
                  '--tw-ring-color': 'var(--ring-accent)',
                } as React.CSSProperties}
              >
                {loading ? t('twoFactorVerifying', lang) : t('signIn', lang)}
              </button>
              <button
                type="button"
                onClick={() => {
                  // Discard the challenge as well as the code: going back means
                  // starting over from the password, not keeping a live
                  // half-finished sign-in around.
                  setMfaToken(null)
                  setCode('')
                  setPassword('')
                  setError(null)
                }}
                className="w-full min-h-11 rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 focus:outline-none focus-visible:ring-2"
                style={{ '--tw-ring-color': 'var(--ring-accent)' } as React.CSSProperties}
              >
                {t('back', lang)}
              </button>
            </form>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                {t('emailAddress', lang)}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full min-h-11 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:border-transparent"
                // Not var(--bs) directly: a pale secondary colour makes the focus ring
                // invisible. --ring-accent is the AA-adjusted variant.
                style={{ '--tw-ring-color': 'var(--ring-accent)' } as React.CSSProperties}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
                {t('password', lang)}
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full min-h-11 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:border-transparent"
                // Not var(--bs) directly: a pale secondary colour makes the focus ring
                // invisible. --ring-accent is the AA-adjusted variant.
                style={{ '--tw-ring-color': 'var(--ring-accent)' } as React.CSSProperties}
                placeholder="••••••••"
              />
            </div>

            {/* A real checkbox with a real label: this decides how long the
                session lives, so it has to be reachable by keyboard and
                announced, not a styled div. */}
            <div className="flex items-center gap-2">
              <input
                id="rememberMe"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 focus:outline-none focus-visible:ring-2"
                style={{ '--tw-ring-color': 'var(--ring-accent)' } as React.CSSProperties}
              />
              <label htmlFor="rememberMe" className="text-sm text-slate-700">
                {t('rememberMe', lang)}
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-11 rounded-md px-4 py-2.5 text-sm font-semibold hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              style={{
                backgroundColor: 'var(--bp)',
                color: 'var(--bp-ink)',
                // The one control on this page that was missing a ring colour,
                // and the worst place to miss it. `ring-2` with no ring-<colour>
                // leaves --tw-ring-color at its Tailwind 4.3.1 fallback of
                // `currentcolor`; currentColor here is --bp-ink, which
                // readableInk('#131921') — the SHIPPED default primary —
                // returns as #ffffff. White ring, #fff offset, white card, and
                // `focus:outline-none` had already removed the UA outline: no
                // focus indicator at all (2.4.7). The three other controls
                // already set this; only the submit button did not.
                '--tw-ring-color': 'var(--ring-accent)',
              } as React.CSSProperties}
            >
              {loading ? t('signingIn', lang) : t('signIn', lang)}
            </button>
          </form>
          )}
        </div>
      </main>
    </div>
  )
}
