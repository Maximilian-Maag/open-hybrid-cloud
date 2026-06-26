import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { ciSources } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getFileContent } from '@/lib/ci'
import { parseTerraformVariables } from '@/lib/tfparser'

const ImportVarsSchema = z.object({
  branch: z.string().min(1),
  filePath: z.string().min(1),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sourceId: string; projectId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { sourceId, projectId } = await params

  const body = await req.json().catch(() => null)
  const parsed = ImportVarsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { branch, filePath } = parsed.data

  const rows = await db
    .select()
    .from(ciSources)
    .where(eq(ciSources.id, parseInt(sourceId, 10)))
    .limit(1)

  if (!rows.length) return NextResponse.json({ error: 'CI source not found' }, { status: 404 })

  const source = rows[0]
  const content = await getFileContent(
    { url: source.url, accessToken: source.accessToken, provider: source.provider },
    decodeURIComponent(projectId),
    branch,
    filePath,
  )

  const parameters = parseTerraformVariables(content)

  return NextResponse.json(parameters)
}
