import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'

/**
 * Read a value from the backend's .env.
 *
 * The account these tests sign in as is the one the backend bootstrap creates
 * from ADMIN_EMAIL / ADMIN_PASSWORD, and those live in apps/backend/.env — which
 * Playwright does not load. Hardcoded defaults here used to be `root@local.dev`,
 * an account nothing ever creates, so a local run failed at auth.setup with an
 * opaque CredentialsSignin. CI is unaffected either way: it sets E2E_ADMIN_* and
 * ADMIN_* to the same values explicitly.
 *
 * Same hand-rolled parse as e2e/global-setup.ts, and for the same reason: no
 * dotenv dependency in the Playwright process.
 */
const fromBackendEnv = (key: string): string | undefined => {
  try {
    const content = readFileSync('./apps/backend/.env', 'utf-8')
    return content.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim()
  } catch {
    return undefined
  }
}

export const rootEmail =
  process.env.E2E_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL ?? fromBackendEnv('ADMIN_EMAIL') ?? 'admin@example.com'
export const rootPassword =
  process.env.E2E_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? fromBackendEnv('ADMIN_PASSWORD') ?? 'changeme'

/**
 * Where the root account's TOTP secret is kept between runs (issue #197).
 *
 * #197 makes a second factor mandatory for administrators, so signing in as root
 * is a two-step flow now and the suite has to be able to produce a code. On CI
 * the database is a fresh service container every run, so `auth.setup` enrols one
 * and writes the secret here; locally, against a database that persists, this is
 * what lets the next run finish the sign-in instead of being stuck at a code
 * field for a secret nobody kept.
 */
export const totpSecretFile = path.join(__dirname, '.auth/root-totp.txt')

/** Base32 (RFC 4648, no padding) — how an authenticator secret is written down. */
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of input.replace(/[\s=]/g, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/**
 * The current six-digit code for a secret (RFC 6238, SHA-1, 30 s).
 *
 * Its own implementation rather than an import from the backend: `e2e/` is not in
 * either app's module graph, and a copy of thirty lines beats a build-time
 * dependency between the suite and the thing it is testing. It is checked against
 * the backend's own implementation by the fact that a wrong code fails the login.
 */
export function totpCode(secretBase32: string, at = Date.now()): string {
  const key = base32Decode(secretBase32)
  const counter = Math.floor(at / 1000 / 30)
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const hmac = createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

/** The RFC 6238 step a moment falls in — the 30-second window a code belongs to. */
export const totpStepOf = (at = Date.now()): number => Math.floor(at / 1000 / 30)

/**
 * Wait until the current step is past `step`.
 *
 * A TOTP code is single-use: `twoFactor.ts` records the step of an accepted code
 * and refuses anything at or below it, which is what stops a code read over a
 * shoulder being replayed for the rest of its window. So two sign-ins inside the
 * same thirty seconds cannot both use the same code — the second is refused, and
 * the login page says "Invalid email or password", which is exactly as
 * informative as it is meant to be and no help at all here.
 *
 * Costs up to thirty seconds, and only when it is actually needed.
 */
/**
 * The last step this process presented a code for.
 *
 * Per worker, which is all it can be — Playwright workers are separate processes.
 * The retry in `completeSecondFactor` is what covers the gap between them.
 */
let lastSpentStep = -1

export async function waitForTotpStepAfter(step: number): Promise<void> {
  while (totpStepOf() <= step) {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
}

/** The stored root secret, or null when nothing has enrolled one yet. */
export function storedRootTotpSecret(): string | null {
  try {
    const value = readFileSync(totpSecretFile, 'utf-8').trim()
    return value === '' ? null : value
  } catch {
    return null
  }
}

/**
 * Finish a sign-in that came back asking for a second factor.
 *
 * Returns false when this account has none, so a caller can use it
 * unconditionally.
 *
 * The wait is a race and not an `isVisible()`, which is what the first version of
 * this got wrong: the code field appears only after the challenge round trip, so
 * asking whether it is visible the instant the button is clicked always answered
 * no, and the caller then sat on `waitForURL` until it timed out. Racing the field
 * against the navigation resolves as soon as either happens, and cannot hang on
 * an account that needs no code.
 */
export async function completeSecondFactor(page: Page): Promise<boolean> {
  const codeField = page.getByLabel(/authentication code/i).first()
  const needsCode = await Promise.race([
    codeField
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => true)
      .catch(() => false),
    page
      .waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60_000 })
      .then(() => false)
      .catch(() => false),
  ])
  if (!needsCode) return false

  const secret = storedRootTotpSecret()
  if (!secret) {
    throw new Error(
      `The sign-in is asking for a second factor and no secret is stored at ${totpSecretFile}. ` +
        'The account already has an authenticator this run did not enrol — drop the e2e database ' +
        '(`make test-db`) so the bootstrap starts clean, or clear its user_totp row.',
    )
  }
  // Wait for a step this process has not already spent, BEFORE filling.
  //
  // Reactive retry was not enough: a rejected code costs a failed submit plus up
  // to thirty seconds of waiting, and Playwright's default test timeout is
  // thirty. auth.setup spends two codes of its own, and every fresh sign-in after
  // it lands in the same window — so the first attempt was usually the spent one
  // and the test died mid-wait with a code field on screen and no error, which
  // reads like the form is broken.
  //
  // Proactive turns that into one wait and one submit. The retry below stays for
  // the case this cannot see: a parallel worker spending the step from under us.
  await waitForTotpStepAfter(lastSpentStep)

  // Up to three steps, because the code has to be one this account has not spent.
  // Codes are single-use and the suite runs in parallel workers, so a step can be
  // spent by another worker — or by the enrolment that just confirmed one — with
  // no way to know from here except being refused. Retrying on the next step is
  // the only answer that does not depend on guessing who spent what.
  for (let attempt = 0; attempt < 2; attempt++) {
    const step = totpStepOf()
    lastSpentStep = step
    await codeField.fill(totpCode(secret))
    // Not /^sign in$/: the step-two button says "Verify" since #240, because
    // repeating the password step's wording read as being asked to log in again.
    await page.getByRole('button', { name: /^verify$/i }).click()

    const signedIn = await page
      .waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    if (signedIn) return true

    // Still on /login: either the code was spent, or the credentials are wrong
    // and no amount of waiting will help. Only the first is worth a retry, and
    // the page cannot tell us which — so try the next step and let the caller's
    // own timeout end it if this is the second case.
    await waitForTotpStepAfter(step)
  }
  return true
}

export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel(/email address/i).fill(email)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  // An administrator's sign-in is two-step since #197; an ordinary account's is
  // not, and this is a no-op for them.
  await completeSecondFactor(page)
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 8000 })
}

export async function loginAsRoot(page: Page): Promise<void> {
  // Fast path: skip re-login when already authenticated (e.g. via storageState)
  await page.goto('/')
  if (!page.url().includes('/login')) return
  await page.getByLabel(/email address/i).fill(rootEmail)
  await page.getByLabel(/password/i).fill(rootPassword)
  await page.getByRole('button', { name: /sign in/i }).click()
  await completeSecondFactor(page)
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 })
}

/**
 * Assert the page is not a server error, without the false positives.
 *
 * Every spec used to assert `expect(page.locator('body')).not.toContainText('500')`,
 * which reads as "no server error" and means "the digits 500 appear nowhere on the
 * page". It failed a green build the first time a fixture was named with a
 * timestamp ending in 500 (`E2E Env CB 1787319807500`), and it would equally fail
 * on a price, a port, a disk size or a product called "500GB SSD".
 *
 * What actually distinguishes an error page: Next.js renders its own shell with no
 * <main> landmark and one of a small set of headings. So assert the application
 * frame rendered, and that the error text is absent — neither of which any amount
 * of ordinary content can trip.
 */
export async function expectNoServerError(page: Page): Promise<void> {
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('Internal Server Error')
  await expect(page.locator('body')).not.toContainText('Application error')
  await expect(page.locator('body')).not.toContainText('This page could not be found')
}

/**
 * Wait until React has taken over the page, then hand back control.
 *
 * Playwright's actionability checks cannot see hydration. A Next.js `<Link>` is
 * in the server HTML, so it is visible, enabled and stable — and clicking it
 * before the router is mounted follows nothing. The click reports success, the
 * page stays where it is, and the failure surfaces later as a URL assertion
 * timing out, which reads as a routing bug rather than a timing one.
 *
 * `HydrationMarker` sets `data-hydrated` on `<html>` from an effect in the root
 * layout, which is the first moment any of this is true.
 *
 * Call it after `goto` and before the first click on a page. It is a wait, not
 * an assertion: a page that never hydrates fails at whatever the test does
 * next, with that test's own message, rather than here with a generic one.
 *
 * After a click that navigates, pass `path`. Next preserves the root layout
 * across a client-side navigation, so the bare attribute is still `true` from
 * the page you left and the wait returns at once, having established nothing —
 * which is worse than not waiting, because it reads like a guarantee.
 * `data-hydrated-path` follows the route, so `hydrated(page, /^\/orders\/\d+$/)`
 * waits for the page you actually arrived at.
 */
export async function hydrated(page: Page, path?: RegExp): Promise<void> {
  await page
    .waitForFunction(
      (source: string | null) => {
        const el = document.documentElement
        if (el.dataset.hydrated !== 'true') return false
        return source === null || new RegExp(source).test(el.dataset.hydratedPath ?? '')
      },
      path ? path.source : null,
      { timeout: 15_000 },
    )
    .catch(() => {})
}

/**
 * The page's own alerts, without the one Next.js puts there.
 *
 * Next's App Router renders `<div role="alert" id="__next-route-announcer__">`
 * into every page to announce client-side navigations. It is empty, it is
 * always present, and it means `getByRole('alert')` can never resolve to one
 * element — so any assertion written as "an alert is shown" fails with a strict
 * mode violation rather than with anything about the alert (#296).
 *
 * Excluded by id rather than by emptiness: an announcer that happens to be
 * mid-announcement has text, and a test should not depend on that timing.
 */
export const pageAlerts = (page: Page) =>
  page.locator('[role="alert"]:not(#__next-route-announcer__)')
