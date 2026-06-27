import type { SessionUser } from '@open-hybrid-cloud/types'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'

export interface SafeUser {
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

export interface CreateUserInput {
  email: string
  name: string
  role: 'admin' | 'project_manager' | 'root'
  password: string
  active: boolean
}

export interface UpdateUserInput {
  name?: string
  role?: 'admin' | 'project_manager' | 'root'
  active?: boolean
  password?: string
}

export const listUsers = async (): Promise<Result<SafeUser[]>> => {
  const rows = await db
    .select(safeUserColumns)
    .from(users)
    .orderBy(sql`${users.createdAt} DESC`)

  return ok(rows as SafeUser[])
}

export const createUser = async (input: CreateUserInput): Promise<Result<SafeUser>> => {
  const { email, name, role, password, active } = input
  const passwordHash = await bcrypt.hash(password, 12)

  try {
    const [user] = await db
      .insert(users)
      .values({ email, name, role, passwordHash, active })
      .returning(safeUserColumns)

    return ok(user as SafeUser)
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return err(409, 'Email already in use')
    }
    throw e
  }
}

export const getUserById = async (id: number): Promise<Result<SafeUser>> => {
  const rows = await db
    .select(safeUserColumns)
    .from(users)
    .where(eq(users.id, id))
    .limit(1)

  if (!rows.length) return err(404, 'Not found')
  return ok(rows[0] as SafeUser)
}

export const updateUser = async (id: number, input: UpdateUserInput): Promise<Result<SafeUser>> => {
  const { password, ...rest } = input
  const update: Record<string, unknown> = { ...rest }

  if (password) {
    update.passwordHash = await bcrypt.hash(password, 12)
  }

  const [updated] = await db
    .update(users)
    .set(update)
    .where(eq(users.id, id))
    .returning(safeUserColumns)

  if (!updated) return err(404, 'Not found')
  return ok(updated as SafeUser)
}

export const deleteUser = async (session: SessionUser, id: number): Promise<Result<void>> => {
  if (id === session.id) return err(400, 'Cannot delete your own account')

  const deleted = await db
    .delete(users)
    .where(eq(users.id, id))
    .returning({ id: users.id })

  if (!deleted.length) return err(404, 'Not found')
  return ok(undefined)
}
