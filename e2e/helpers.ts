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
 * Returns false when the page is not at the code step, so a caller can use it
 * unconditionally: an account with no factor simply never reaches it.
 */
export async function completeSecondFactor(page: Page): Promise<boolean> {
  const codeField = page.getByLabel(/authentication code|code/i).first()
  if (!(await codeField.isVisible().catch(() => false))) return false

  const secret = storedRootTotpSecret()
  if (!secret) {
    throw new Error(
      `The sign-in is asking for a second factor and no secret is stored at ${totpSecretFile}. ` +
        'The account already has an authenticator this run did not enrol — drop the e2e database ' +
        '(`make test-db`) so the bootstrap starts clean, or clear its user_totp row.',
    )
  }
  await codeField.fill(totpCode(secret))
  await page.getByRole('button', { name: /verify|sign in|continue/i }).first().click()
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
