import path from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db } from '@/lib/db/client'
import { users, branding } from '@/lib/db/schema'
import bcrypt from 'bcryptjs'

let bootstrapped = false

export const runBootstrap = async (): Promise<void> => {
  if (bootstrapped) return
  bootstrapped = true

  try {
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') })
  } catch (err: unknown) {
    // 42P07 = relation already exists — schema was applied outside the migration
    // system (e.g. via db:push). Treat the DB as already migrated and continue.
    if ((err as { cause?: { code?: string } })?.cause?.code !== '42P07') {
      bootstrapped = false
      throw err
    }
  }

  // Seed branding data if it does not exist
  const brandingExists = await db.select({ id: branding.id }).from(branding).limit(1)
  if (brandingExists.length === 0) {
    await db.insert(branding).values({
      shopName: 'Open Hybrid Cloud',
      shopSubtitle: 'Self-Service Portal',
      primaryColor: '#ca8a04',
      secondaryColor: '#f5f5f4',
    })
    console.warn(`[bootstrap] Default branding created.`)
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
