import { NextRequest, NextResponse } from 'next/server'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { auditLog, users } from '@/lib/db/schema'
import { eq, and, gte, lte, sql } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId') ? parseInt(searchParams.get('userId')!, 10) : undefined
  const action = searchParams.get('action') ?? undefined
  const from = searchParams.get('from') ?? undefined
  const to = searchParams.get('to') ?? undefined
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const pageSize = Math.min(parseInt(searchParams.get('pageSize') ?? '50', 10), 200)

  const conditions = []
  if (userId) conditions.push(eq(auditLog.userId, userId))
  if (action) conditions.push(eq(auditLog.action, action))
  if (from) conditions.push(gte(auditLog.createdAt, new Date(from)))
  if (to) conditions.push(lte(auditLog.createdAt, new Date(to)))

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const [countResult, rows] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(auditLog)
      .where(whereClause),
    db
      .select({
        id: auditLog.id,
        userId: auditLog.userId,
        action: auditLog.action,
        entityId: auditLog.entityId,
        details: auditLog.details,
        createdAt: auditLog.createdAt,
        userName: users.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.userId, users.id))
      .where(whereClause)
      .orderBy(sql`${auditLog.createdAt} DESC`)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ])

  return NextResponse.json({
    data: rows,
    total: countResult[0]?.count ?? 0,
    page,
    pageSize,
  })
}
