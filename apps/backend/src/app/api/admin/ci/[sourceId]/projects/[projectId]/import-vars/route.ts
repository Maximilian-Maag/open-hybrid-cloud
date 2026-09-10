import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse, parseRouteId, invalidId } from '@/lib/http'
import { importCiVars } from '@/lib/services/admin/ciSources'

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
  const ciSourceId = parseRouteId(sourceId)
  if (ciSourceId === null) return invalidId('CI source id')

  const body = await req.json().catch(() => null)
  const parsed = ImportVarsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await importCiVars(
    ciSourceId,
    decodeURIComponent(projectId),
    parsed.data.branch,
    parsed.data.filePath,
  ))
}
