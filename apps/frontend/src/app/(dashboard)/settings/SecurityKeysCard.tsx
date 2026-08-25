'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { startRegistration } from '@simplewebauthn/browser'
import type {
  WebauthnCredential,
  WebauthnCredentialsResponse,
  WebauthnRegistrationResult,
} from '@open-hybrid-cloud/types'
import { get, post, del } from '@/lib/api'
import { Card } from '@/components/ui/Card'
import { Alert } from '@/components/ui/Alert'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useLang } from '@/lib/useLang'
import { t } from '@/lib/i18n'

interface Props {
  token: string
}

/**
 * Security keys and passkeys (issue #197, part 2).
 *
 * A sibling of `TwoFactorCard` rather than a tab inside it, because they are not
 * alternatives the user picks between: either satisfies the requirement, and
 * holding both is the sensible thing — a key for every day, an authenticator app
 * for the day the key is in the other coat.
 *
 * The ceremony itself is the browser's. `startRegistration` opens the platform
 * prompt, and the private key never leaves the authenticator; what comes back is
 * a public key and an attestation for the server to verify.
 */
export function SecurityKeysCard({ token }: Props) {
  const { data: session, update: updateSession } = useSession()
  // The token's copy of the gate, which is what the middleware reads.
  const mustEnroll = session?.mustEnrollSecondFactor === true
  const lang = useLang()
  const [credentials, setCredentials] = useState<WebauthnCredential[] | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])

  const load = useCallback(async () => {
    try {
      const data = await get<WebauthnCredentialsResponse>('/api/users/me/webauthn', token)
      setCredentials(data.credentials)
    } catch {
      // A list that cannot be read is not worth an error banner over the whole
      // settings page; the card shows nothing until it can.
      setCredentials(null)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  /** Whether this browser can do WebAuthn at all — an old one simply cannot. */
  const [supported, setSupported] = useState(true)
  useEffect(() => {
    setSupported(typeof window !== 'undefined' && Boolean(window.PublicKeyCredential))
  }, [])

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const options = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>(
        '/api/users/me/webauthn/register/options',
        {},
        token,
      )
      // Opens the platform prompt. Everything the user does — touching the key,
      // Touch ID, a PIN — happens inside here, and the private half of the
      // credential never leaves the authenticator.
      const response = await startRegistration({ optionsJSON: options })
      const result = await post<WebauthnRegistrationResult>(
        '/api/users/me/webauthn/register/verify',
        { label: label.trim(), response },
        token,
      )
      setLabel('')
      // Present only when this was the first factor on the account, and this is
      // the only copy that will ever exist.
      if (result.recoveryCodes?.length) setRecoveryCodes(result.recoveryCodes)
      await load()

      // Lift the enrolment gate, exactly as `TwoFactorCard` does after a
      // confirmed TOTP secret (#197).
      //
      // `secondFactorOutstanding` already stopped counting this account the
      // moment the credential was stored — it re-reads both factors per request,
      // and a key discharges the requirement as much as an app does. But the
      // MIDDLEWARE reads `mustEnrollSecondFactor` off the token minted at
      // sign-in, and nothing here was rewriting it. So an administrator who
      // registered a key was still redirected to /settings?enroll2fa=1 from
      // every page, and still shown "two-factor authentication is required" —
      // having done exactly what was asked of them, with the only way out being
      // to sign out and back in.
      //
      // After the recovery codes are on screen, not before: lifting the gate
      // must not race the user reading the only copy of them.
      if (mustEnroll) {
        const { getSession } = await import('next-auth/react')
        await updateSession({ mustEnrollSecondFactor: false })
        await getSession()
      }
    } catch (err) {
      // A user who closes the prompt lands here too, and telling them their key
      // failed would be wrong — so the browser's own abort is not an error.
      if (err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
        return
      }
      setError(err instanceof Error ? err.message : t('unexpectedError', lang))
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(id: number) {
    setError(null)
    setBusy(true)
    try {
      await del(`/api/users/me/webauthn/${id}`, token)
      await load()
    } catch (err) {
      // Includes the 409 for removing the last factor an account has, whose
      // message says what to do instead.
      setError(err instanceof Error ? err.message : t('unexpectedError', lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t('securityKeys', lang)}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}

        <p className="text-sm text-slate-600">{t('securityKeysIntro', lang)}</p>

        {!supported && <Alert tone="warning">{t('securityKeysUnsupported', lang)}</Alert>}

        {recoveryCodes.length > 0 && (
          <div className="space-y-2">
            <Alert tone="warning">{t('twoFactorRecoveryHint', lang)}</Alert>
            <ul className="grid gap-1 font-mono text-sm sm:grid-cols-2">
              {recoveryCodes.map((c) => (
                <li key={c} className="rounded bg-slate-50 px-3 py-1.5 text-slate-900">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        {credentials && credentials.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {credentials.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">{c.label}</p>
                  <p className="text-xs text-slate-500">
                    {t('added', lang)} {new Date(c.createdAt).toLocaleDateString(lang)}
                    {c.lastUsedAt
                      ? ` · ${t('lastUsed', lang)} ${new Date(c.lastUsedAt).toLocaleDateString(lang)}`
                      : ` · ${t('neverUsed', lang)}`}
                  </p>
                </div>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => void handleRemove(c.id)}
                >
                  {t('remove', lang)}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          credentials !== null && <p className="text-sm text-slate-600">{t('noSecurityKeys', lang)}</p>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          <Input
            label={t('securityKeyName', lang)}
            hint={t('securityKeyNameHint', lang)}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={64}
            required
          />
          <Button type="submit" disabled={busy || !supported}>
            {busy ? t('registering', lang) : t('registerSecurityKey', lang)}
          </Button>
        </form>
      </div>
    </Card>
  )
}
