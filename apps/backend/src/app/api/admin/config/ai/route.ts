import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { appConfig } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const UpdateAiSchema = z.object({
  provider: z.enum(['claude', 'openai', 'azure_openai', 'ollama', 'localai']),
  endpoint: z.string().min(1),
  apiKey: z.string().optional(),
  model: z.string().min(1),
})

export async function GET(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const rows = await db
    .select({
      aiProvider: appConfig.aiProvider,
      aiEndpoint: appConfig.aiEndpoint,
      aiModel: appConfig.aiModel,
      // Never return aiApiKey
    })
    .from(appConfig)
    .where(eq(appConfig.id, 1))
    .limit(1)

  if (!rows.length) {
    return NextResponse.json({ aiProvider: null, aiEndpoint: null, aiModel: null })
  }

  return NextResponse.json(rows[0])
}

export async function PUT(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = UpdateAiSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { provider, endpoint, apiKey, model } = parsed.data

  const setValues: Partial<typeof appConfig.$inferInsert> = {
    aiProvider: provider,
    aiEndpoint: endpoint,
    aiModel: model,
  }
  if (apiKey !== undefined) setValues.aiApiKey = apiKey

  await db
    .insert(appConfig)
    .values({ id: 1, ...setValues })
    .onConflictDoUpdate({ target: appConfig.id, set: setValues })

  return NextResponse.json({ success: true })
}
