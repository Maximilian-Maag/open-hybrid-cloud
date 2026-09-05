/**
 * Configuration that must be right before the server can do its job.
 *
 * These are checked at bootstrap rather than at the point of use, because the
 * point of use is the wrong place to find out: an invalid JWT_SECRET makes
 * `signToken` throw during login, which reaches the browser as a failed sign-in
 * and reads as "wrong password". The operator then debugs the password.
 */
import { SECRET_KEY_ENV, SECRET_KEY_HEX_LENGTH, isValidSecretKey } from '@/lib/crypto/secrets'

/** Minimum length for an HS256 signing key — 256 bits of secret. */
export const MIN_JWT_SECRET_LENGTH = 32

/**
 * Only the variables this module reads, so a caller can pass a fixture.
 *
 * An index signature rather than a closed record: `process.env` is a
 * `ProcessEnv`, and a closed shape has "no properties in common" with it as far
 * as the compiler is concerned.
 */
export type ConfigEnv = { [key: string]: string | undefined }

export interface ConfigProblem {
  variable: string
  message: string
}

/** Every configuration problem found, in the order they should be fixed. */
export const configProblems = (env: ConfigEnv = process.env): ConfigProblem[] => {
  const problems: ConfigProblem[] = []

  const jwtSecret = env.JWT_SECRET ?? ''
  if (jwtSecret === '') {
    problems.push({
      variable: 'JWT_SECRET',
      message: 'is not set — every login will fail. Generate one with `openssl rand -base64 48`.',
    })
  } else if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    problems.push({
      variable: 'JWT_SECRET',
      message:
        `is ${jwtSecret.length} characters; at least ${MIN_JWT_SECRET_LENGTH} are required, ` +
        'so every login will fail. Generate one with `openssl rand -base64 48`.',
    })
  }

  if ((env.DATABASE_URL ?? '') === '') {
    problems.push({
      variable: 'DATABASE_URL',
      message: 'is not set — the server cannot reach its database.',
    })
  }

  // SECRET_ENCRYPTION_KEY (issue #111) is reported only when it is SET but
  // unusable, which is the case an operator got wrong. Its plain ABSENCE is not
  // a problem in this sense: the portal runs fine without external-system
  // integrations, and warning about it every boot on every deployment that does
  // not use them is the kind of noise that trains people to ignore this block.
  // The absent case is reported where it actually matters — the credential paths
  // refuse with a 503 naming this variable (lib/services/admin/integrations.ts)
  // rather than falling back to storing the credential in plain text.
  const secretKey = env[SECRET_KEY_ENV]
  if (secretKey !== undefined && secretKey !== '' && !isValidSecretKey(secretKey)) {
    problems.push({
      variable: SECRET_KEY_ENV,
      message:
        `is set but is not ${SECRET_KEY_HEX_LENGTH} hex characters, so integration ` +
        'credentials cannot be encrypted or decrypted. Generate one with ' +
        '`openssl rand -hex 32`. Note that a key which is later CHANGED cannot ' +
        'decrypt what the previous key wrote.',
    })
  }

  // A wrong-length key is a hard problem: enrolled TOTP secrets become
  // undecryptable and every 2FA login fails closed. An UNSET key is not reported
  // here — it falls back to a key derived from JWT_SECRET, which works, and
  // lib/auth/totpSecret.ts warns about the consequence (rotating JWT_SECRET then
  // invalidates every enrolled authenticator). Reporting both would train
  // operators to ignore this section.
  const totpKey = (env.TOTP_ENCRYPTION_KEY ?? '').trim()
  if (totpKey !== '' && !isValidTotpKey(totpKey)) {
    problems.push({
      variable: 'TOTP_ENCRYPTION_KEY',
      message:
        'is set but is not 32 bytes — two-factor logins will fail for everyone enrolled. ' +
        'Generate one with `openssl rand -base64 32`.',
    })
  }

  return problems
}

/** 32 bytes, as 64 hex characters or as base64. */
const isValidTotpKey = (value: string): boolean => {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return true
  try {
    return Buffer.from(value, 'base64').length === 32
  } catch {
    return false
  }
}

/**
 * Report problems on stderr, once, at startup.
 *
 * Deliberately does NOT throw: a running server that refuses logins is easier to
 * diagnose than one that will not start, and the same code path runs during
 * `next build`, where none of this is configured.
 */
export const reportConfigProblems = (env: ConfigEnv = process.env): ConfigProblem[] => {
  const problems = configProblems(env)
  for (const problem of problems) {
    console.error(`[config] ${problem.variable} ${problem.message}`)
  }
  return problems
}
