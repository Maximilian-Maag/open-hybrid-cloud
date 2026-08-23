import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import type { SessionUser } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createSession } from '@/lib/auth/sessions'
import { peekMfaChallengeUserId, signMfaChallenge, verifyMfaChallenge } from '@/lib/auth/mfaChallenge'
import { requiresSecondFactor, verifySecondFactor } from '@/lib/services/twoFactor'
import { logAudit } from '@/lib/audit'
import { ok, err, type Result } from '@/lib/services/result'

export interface UserProfile {
  id: number
  email: string
  name: string
  role: string
  active: boolean
  ssoSub: string | null
  createdAt: Date
}

const safeUserColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  active: users.active,
  ssoSub: users.ssoSub,
  createdAt: users.createdAt,
}

/** Where the login came from, recorded on the session row (issue #37). */
export interface LoginContext {
  ip?: string | null
  userAgent?: string | null
  rememberMe?: boolean
}

/**
 * What a successful password check earns.
 *
 * Either a session — or, when the account has a second factor, a *challenge*:
 * proof that the password was right, and nothing more. The two are a
 * discriminated union rather than "a token plus a flag" because the requirement
 * is that no usable token exists before the second factor, and a shape where the
 * token field is simply absent is the only version of that a caller cannot get
 * wrong by ignoring a boolean.
 */
export type LoginOutcome =
  | { mfaRequired: false; token: string; user: SessionUser }
  | { mfaRequired: true; mfaToken: string }

/**
 * What the password step alone establishes — before any session exists.
 *
 * The no-second-factor arm carries the user and NOT a token, because at this
 * point in the flow no session has been opened. Whether one ever is depends on
 * the caller: `loginWithCredentials` opens it, `checkLoginPassword` deliberately
 * does not.
 */
export type PasswordOutcome =
  | { mfaRequired: true; mfaToken: string }
  | { mfaRequired: false; user: SessionUser }

const sessionUserOf = (user: {
  id: number
  email: string
  name: string
  role: string
}): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role as SessionUser['role'],
})

/**
 * Open a session, turning a misconfiguration into a 500 rather than a 401.
 *
 * Without this the JWT_SECRET check inside signToken throws, the route 500s with
 * no body, and NextAuth reports CredentialsSignin — so a misconfigured
 * deployment looks exactly like a wrong password, which is what an operator then
 * spends the afternoon debugging.
 *
 * Since #37 the same try also covers writing the session row: a token with no
 * row behind it is refused by every request, so failing to write the row is
 * failing to log in, and it should say so here rather than a moment later as a
 * 401 on the first page.
 *
 * Since #36 this is called from two places — the one-step login and the second
 * step of a two-step one — and `createSession` is still the only way either of
 * them gets a token, so a session opened after a TOTP code is as revocable as
 * any other.
 */
const issueSession = async (user: SessionUser, context: LoginContext): Promise<Result<string>> => {
  try {
    const { token } = await createSession({
      user,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      rememberMe: context.rememberMe ?? false,
    })
    return ok(token)
  } catch (e) {
    console.error('[auth] Could not open a session — check JWT_SECRET and the database:', e)
    return err(500, 'The server is misconfigured and cannot issue a session. See the server log.')
  }
}

/**
 * Check an email and password, and nothing else.
 *
 * Nothing here writes a `sessions` row or signs a session token, on either
 * branch — the second-factor branch by requirement (#36), the other one because
 * this is also what the two-step sign-in's first hop calls, and that hop throws
 * any token away (see the frontend's `app/api/login-challenge/route.ts`). Minting
 * one for it would leave a session in the user's own list that no browser holds.
 *
 * `rememberMe` is taken here rather than at the second step because this is where
 * the user actually made the choice; for a two-step sign-in it is sealed into the
 * challenge, so the second step cannot be talked into a 30-day session.
 */
export const checkLoginPassword = async (
  email: string,
  password: string,
  rememberMe = false,
): Promise<Result<PasswordOutcome>> => {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  const user = rows[0]
  if (!user || !user.active || !user.passwordHash) {
    return err(401, 'Invalid credentials')
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) return err(401, 'Invalid credentials')

  // The password was right. If a second factor is enrolled, that is ALL that has
  // been established — no session row is written and no session token is signed
  // on this path at all, so there is nothing here for a caller to accidentally
  // hand out, and nothing for a revocation check to have to catch later.
  if (await requiresSecondFactor(user.id)) {
    let mfaToken: string
    try {
      mfaToken = await signMfaChallenge(user.id, user.passwordHash, rememberMe)
    } catch (e) {
      console.error('[auth] Could not sign an MFA challenge — check JWT_SECRET:', e)
      return err(500, 'The server is misconfigured and cannot issue a session. See the server log.')
    }
    await logAudit(user.id, 'auth.2fa.challenged', user.id, 'Password accepted; second factor required')
    return ok({ mfaRequired: true, mfaToken })
  }

  return ok({ mfaRequired: false, user: sessionUserOf(user) })
}

export const loginWithCredentials = async (
  email: string,
  password: string,
  context: LoginContext = {},
): Promise<Result<LoginOutcome>> => {
  const outcome = await checkLoginPassword(email, password, context.rememberMe ?? false)
  if (!outcome.ok) return outcome
  if (outcome.data.mfaRequired) return ok(outcome.data)

  const sessionUser = outcome.data.user
  const token = await issueSession(sessionUser, context)
  if (!token.ok) return token
  return ok({ mfaRequired: false, token: token.data, user: sessionUser })
}

/**
 * Second half of a two-step login: redeem a challenge with a second factor.
 *
 * The challenge is verified against the account's *current* password hash, so a
 * challenge issued before a password change or an operator-forced reset stops
 * being redeemable — a five-minute expiry alone would leave a window where a
 * just-revoked credential still finishes a login.
 *
 * Only past the code check does `issueSession` run, so the `sessions` row and the
 * token that names it come into existence together, here, and nowhere earlier.
 */
export const completeMfaLogin = async (
  mfaToken: string,
  code: string,
  context: LoginContext = {},
): Promise<Result<{ token: string; user: SessionUser }>> => {
  // Two passes over the token: the first only to learn which user to look up,
  // the second — inside verifyMfaChallenge — to check the signature against that
  // user's credential fingerprint. The first pass already verifies the signature,
  // so an attacker cannot smuggle an arbitrary id through it.
  const userId = await peekMfaChallengeUserId(mfaToken)
  if (userId === null) return err(401, 'This sign-in attempt has expired. Start again.')

  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  const user = rows[0]
  if (!user || !user.active || !user.passwordHash) {
    return err(401, 'This sign-in attempt has expired. Start again.')
  }

  const challenge = await verifyMfaChallenge(mfaToken, user.passwordHash)
  if (!challenge || challenge.userId !== user.id) {
    return err(401, 'This sign-in attempt has expired. Start again.')
  }

  const verified = await verifySecondFactor(user.id, code, { stage: 'login' })
  if (!verified.ok) return verified

  const sessionUser = sessionUserOf(user)
  // "Remember me" comes from the challenge, not from this request: the user
  // ticked the box at the password step, and a signed claim is the only version
  // of that answer the second step cannot be asked to change.
  const token = await issueSession(sessionUser, { ...context, rememberMe: challenge.rememberMe })
  if (!token.ok) return token

  await logAudit(
    user.id,
    'auth.login.mfa',
    user.id,
    `Signed in with a second factor (${verified.data.kind})`,
  )
  return ok({ token: token.data, user: sessionUser })
}

export const getMe = async (userId: number): Promise<Result<UserProfile>> => {
  const rows = await db
    .select(safeUserColumns)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!rows.length) return err(404, 'User not found')
  return ok(rows[0] as UserProfile)
}

export const updateMe = async (
  userId: number,
  input: { name: string },
): Promise<Result<UserProfile>> => {
  const [updated] = await db
    .update(users)
    .set({ name: input.name })
    .where(eq(users.id, userId))
    .returning(safeUserColumns)

  if (!updated) return err(404, 'User not found')
  return ok(updated as UserProfile)
}

export const changePassword = async (
  userId: number,
  currentPassword: string,
  newPassword: string,
): Promise<Result<void>> => {
  const rows = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  const user = rows[0]
  if (!user?.passwordHash) {
    return err(400, 'Password change not allowed for SSO accounts')
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) return err(400, 'Current password is incorrect')

  const newHash = await bcrypt.hash(newPassword, 12)
  await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, userId))

  return ok(undefined)
}

/** True for the unique-violation Postgres raises on users.email / users.sso_sub. */
const isUniqueViolation = (e: unknown): boolean => {
  const messages: string[] = []
  if (e instanceof Error) {
    messages.push(e.message)
    const cause = (e as { cause?: unknown }).cause
    if (cause instanceof Error) messages.push(cause.message)
    else if (typeof cause === 'object' && cause !== null && 'message' in cause) {
      messages.push(String((cause as { message: unknown }).message))
    }
  }
  const code = (e as { code?: string; cause?: { code?: string } })
  if (code?.code === '23505' || code?.cause?.code === '23505') return true
  return messages.some((m) => m.includes('unique') || m.includes('duplicate'))
}

/**
 * Find or create the local account behind an SSO identity.
 *
 * Returns null when no account can be established, which the callback route turns
 * into `?error=account_error`. That case is real and used to be a 500: `users.email`
 * is UNIQUE, so an SSO identity whose email matches an existing LOCAL account
 * raised 23505 out of an insert nobody caught, and the user could never sign in
 * (issue #142). Renaming an already-linked account into another user's email hits
 * the same constraint on the UPDATE.
 *
 * The collision is refused rather than resolved by adopting the existing account.
 * Linking on a matching email would make the id_token's email claim sufficient to
 * take over any local account, root included; deliberate linking is an operator's
 * decision (set `sso_sub` on the account), not something a login should do on its
 * own. The reason lands in the server log, because that is where the operator who
 * has to make that decision will be looking — but WITHOUT the subject or the email,
 * which are the two values that name the person. Application logs are shipped,
 * aggregated and retained on their own schedule, well outside anything the deletion
 * request for that account can reach, so a failed login must not be what writes an
 * address into them. The correlation id is what is left to tie an operator's log
 * line to the sign-in a user is reporting.
 */
export const upsertSsoUser = async (
  sub: string,
  email: string,
  name: string,
): Promise<{ id: number; email: string; name: string; role: string; active: boolean } | null> => {
  // Projected, like every other read in this file: an unprojected `.returning()`
  // hands back `passwordHash` on an object the callback route then builds a
  // session from — no leak today, one `NextResponse.json(user)` away from one.
  const existing = await db
    .select(safeUserColumns)
    .from(users)
    .where(eq(users.ssoSub, sub))
    .limit(1)

  try {
    if (existing.length > 0) {
      const [updated] = await db
        .update(users)
        .set({ email, name })
        .where(eq(users.ssoSub, sub))
        .returning(safeUserColumns)
      return updated ?? null
    }

    const [created] = await db
      .insert(users)
      .values({ email, name, role: 'project_manager', ssoSub: sub, active: true })
      .returning(safeUserColumns)
    return created ?? null
  } catch (e) {
    if (!isUniqueViolation(e)) throw e
    console.error(
      `[auth] Refused an SSO login (ref ${randomUUID()}): the identity's email address already belongs ` +
        'to another account. Link the two deliberately by setting that account\'s sso_sub, or change one ' +
        'of the two addresses.',
    )
    return null
  }
}
