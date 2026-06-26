import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { deploymentEnvironments, ciSources } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const CreateEnvironmentSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  ciSourceId: z.number().int().positive(),
  webhookUrl: z.string().url(),
  webhookToken: z.string().min(1),
})

export async function GET(req: NextRequest) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const rows = await db
    .select({
      id: deploymentEnvironments.id,
      name: deploymentEnvironments.name,
      description: deploymentEnvironments.description,
      ciSourceId: deploymentEnvironments.ciSourceId,
      webhookUrl: deploymentEnvironments.webhookUrl,
      ciSourceName: ciSources.name,
    })
    .from(deploymentEnvironments)
    .leftJoin(ciSources, eq(deploymentEnvironments.ciSourceId, ciSources.id))
    .orderBy(deploymentEnvironments.name)

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = CreateEnvironmentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const [env] = await db
    .insert(deploymentEnvironments)
    .values(parsed.data)
    .returning()

  return NextResponse.json(env, { status: 201 })
}
