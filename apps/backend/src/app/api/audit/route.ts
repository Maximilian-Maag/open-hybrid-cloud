import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { listAuditLog } from '@/lib/services/audit'

export async function GET(req: NextRequest) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId') ? parseInt(searchParams.get('userId') ?? '0', 10) : undefined
  const action = searchParams.get('action') ?? undefined
  const from = searchParams.get('from') ?? undefined
  const to = searchParams.get('to') ?? undefined
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const pageSize = Math.min(parseInt(searchParams.get('pageSize') ?? '50', 10), 200)

  const result = await listAuditLog({ userId, action, from, to }, page, pageSize)
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })

  return NextResponse.json({
    data: result.data.rows,
    total: result.data.total,
    page,
    pageSize,
  })
}
