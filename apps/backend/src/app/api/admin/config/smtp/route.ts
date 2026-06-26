import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { appConfig } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const UpdateSmtpSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  from: z.string().min(1),
  user: z.string().default(''),
  password: z.string().optional(),
  tls: z.boolean().default(true),
})

export async function GET(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const rows = await db
    .select({
      smtpHost: appConfig.smtpHost,
      smtpPort: appConfig.smtpPort,
      smtpFrom: appConfig.smtpFrom,
      smtpUser: appConfig.smtpUser,
      smtpTls: appConfig.smtpTls,
      // Never return smtpPass
    })
    .from(appConfig)
    .where(eq(appConfig.id, 1))
    .limit(1)

  if (!rows.length) {
    return NextResponse.json({ smtpHost: null, smtpPort: null, smtpFrom: null, smtpUser: null, smtpTls: true })
  }

  return NextResponse.json(rows[0])
}

export async function PUT(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = UpdateSmtpSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { host, port, from, user, password, tls } = parsed.data

  const setValues: Partial<typeof appConfig.$inferInsert> = {
    smtpHost: host,
    smtpPort: port,
    smtpFrom: from,
    smtpUser: user,
    smtpTls: tls,
  }
  if (password !== undefined) setValues.smtpPass = password

  await db
    .insert(appConfig)
    .values({ id: 1, ...setValues })
    .onConflictDoUpdate({ target: appConfig.id, set: setValues })

  return NextResponse.json({ success: true })
}
