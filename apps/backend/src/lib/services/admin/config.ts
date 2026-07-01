import { db } from '@/lib/db/client'
import { appConfig } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ok, type Result } from '@/lib/services/result'

export interface SmtpConfig {
  host: string
  port: number
  from: string
  user: string
  tls: boolean
}

export interface UpdateSmtpInput {
  host: string
  port: number
  from: string
  user?: string
  password?: string
  tls?: boolean
}

export interface AiConfig {
  provider: string
  endpoint: string
  model: string
}

export interface UpdateAiInput {
  provider: string
  endpoint: string
  apiKey?: string
  model: string
}

export const getSmtpConfig = async (): Promise<Result<SmtpConfig>> => {
  const rows = await db
    .select({
      smtpHost: appConfig.smtpHost,
      smtpPort: appConfig.smtpPort,
      smtpFrom: appConfig.smtpFrom,
      smtpUser: appConfig.smtpUser,
      smtpTls: appConfig.smtpTls,
    })
    .from(appConfig)
    .where(eq(appConfig.id, 1))
    .limit(1)

  if (!rows.length) {
    return ok({ host: '', port: 587, from: '', user: '', tls: true })
  }

  const row = rows[0]
  return ok({
    host: row.smtpHost ?? '',
    port: row.smtpPort ?? 587,
    from: row.smtpFrom ?? '',
    user: row.smtpUser ?? '',
    tls: row.smtpTls ?? true,
  })
}

export const updateSmtpConfig = async (input: UpdateSmtpInput): Promise<Result<void>> => {
  const setValues: Partial<typeof appConfig.$inferInsert> = {
    smtpHost: input.host,
    smtpPort: input.port,
    smtpFrom: input.from,
    smtpUser: input.user ?? '',
    smtpTls: input.tls ?? true,
  }
  if (input.password !== undefined) setValues.smtpPass = input.password

  await db
    .insert(appConfig)
    .values({ id: 1, ...setValues })
    .onConflictDoUpdate({ target: appConfig.id, set: setValues })

  return ok(undefined)
}

export const getAiConfig = async (): Promise<Result<AiConfig>> => {
  const rows = await db
    .select({
      aiProvider: appConfig.aiProvider,
      aiEndpoint: appConfig.aiEndpoint,
      aiModel: appConfig.aiModel,
    })
    .from(appConfig)
    .where(eq(appConfig.id, 1))
    .limit(1)

  if (!rows.length) {
    return ok({ provider: 'claude', endpoint: '', model: '' })
  }

  const row = rows[0]
  return ok({
    provider: row.aiProvider || 'claude',
    endpoint: row.aiEndpoint ?? '',
    model: row.aiModel ?? '',
  })
}

export const updateAiConfig = async (input: UpdateAiInput): Promise<Result<void>> => {
  const setValues: Partial<typeof appConfig.$inferInsert> = {
    aiProvider: input.provider,
    aiEndpoint: input.endpoint,
    aiModel: input.model,
  }
  if (input.apiKey !== undefined) setValues.aiApiKey = input.apiKey

  await db
    .insert(appConfig)
    .values({ id: 1, ...setValues })
    .onConflictDoUpdate({ target: appConfig.id, set: setValues })

  return ok(undefined)
}
