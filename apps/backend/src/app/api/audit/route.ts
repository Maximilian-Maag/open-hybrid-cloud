import { type NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { listAuditLog } from '@/lib/services/audit'
import { parseAuditFilters } from '@/lib/services/auditFilters'

export async function GET(req: NextRequest) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { searchParams } = new URL(req.url)
  const query = parseAuditFilters(searchParams)
  if (!query.ok) return NextResponse.json({ error: query.message }, { status: query.status })

  const { filters, page, pageSize } = query.data
  const result = await listAuditLog(filters, page, pageSize)
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })

  return NextResponse.json({
    data: result.data.rows,
    total: result.data.total,
    page,
    pageSize,
  })
}
