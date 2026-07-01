import path from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import bcrypt from 'bcryptjs'

let bootstrapped = false

export const runBootstrap = async (): Promise<void> => {
  if (bootstrapped) return
  bootstrapped = true

  try {
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') })
  } catch (err) {
    bootstrapped = false
    throw err
  }

  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD

  if (!email || !password) return

  const existing = await db.select({ id: users.id }).from(users).limit(1)
  if (existing.length > 0) return

  const passwordHash = await bcrypt.hash(password, 12)
  await db.insert(users).values({
    email,
    name: 'Root Admin',
    role: 'root',
    passwordHash,
    active: true,
  })

  console.warn(`[bootstrap] Root user created: ${email}`)
}
