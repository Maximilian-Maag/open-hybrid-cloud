import { NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { ciSources } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { listBranches } from '@/lib/ci'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sourceId: string; projectId: string }> },
) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const { sourceId, projectId } = await params

  const rows = await db
    .select()
    .from(ciSources)
    .where(eq(ciSources.id, parseInt(sourceId, 10)))
    .limit(1)

  if (!rows.length) return NextResponse.json({ error: 'CI source not found' }, { status: 404 })

  const source = rows[0]
  const branches = await listBranches(
    { url: source.url, accessToken: source.accessToken, provider: source.provider },
    decodeURIComponent(projectId),
  )

  return NextResponse.json(branches)
}
