/**
 * Configuration that must be right before the server can do its job.
 *
 * These are checked at bootstrap rather than at the point of use, because the
 * point of use is the wrong place to find out: an invalid JWT_SECRET makes
 * `signToken` throw during login, which reaches the browser as a failed sign-in
 * and reads as "wrong password". The operator then debugs the password.
 */

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

  return problems
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
