import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createSession } from '@/lib/auth/sessions'
import { ok, err, type Result } from '@/lib/services/result'
import type { Role } from '@open-hybrid-cloud/types'

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

export const loginWithCredentials = async (
  email: string,
  password: string,
  context: LoginContext = {},
): Promise<Result<string>> => {
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

  const sessionUser = { id: user.id, email: user.email, name: user.name, role: user.role as Role }

  // The credentials were correct; anything failing from here is the server's
  // fault. Without this the JWT_SECRET check inside signToken throws, the route
  // 500s with no body, and NextAuth reports CredentialsSignin — so a
  // misconfigured deployment looks exactly like a wrong password, which is what
  // an operator then spends the afternoon debugging.
  //
  // Since #37 the same try also covers opening the session row: a token with no
  // row behind it is refused by every request, so failing to write the row is
  // failing to log in, and it should say so here rather than a moment later as a
  // 401 on the first page.
  try {
    const { token } = await createSession({
      user: sessionUser,
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
