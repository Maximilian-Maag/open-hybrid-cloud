import bcrypt from 'bcryptjs'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { signToken } from '@/lib/auth/jwt'
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

export const loginWithCredentials = async (
  email: string,
  password: string,
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

  const sessionUser = { id: user.id, email: user.email, name: user.name, role: user.role }
  const token = await signToken(sessionUser)
  return ok(token)
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

export const upsertSsoUser = async (
  sub: string,
  email: string,
  name: string,
): Promise<{ id: number; email: string; name: string; role: string; active: boolean } | null> => {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.ssoSub, sub))
    .limit(1)

  let user: typeof existing[0]
  if (existing.length > 0) {
    const [updated] = await db
      .update(users)
      .set({ email, name })
      .where(eq(users.ssoSub, sub))
      .returning()
    user = updated
  } else {
    const [created] = await db
      .insert(users)
      .values({ email, name, role: 'project_manager', ssoSub: sub, active: true })
      .returning()
    user = created
  }

  return user
}
