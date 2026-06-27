import { db } from '@/lib/db/client'
import { auditLog, users } from '@/lib/db/schema'
import { eq, and, gte, lte, ilike, sql } from 'drizzle-orm'
import { ok, type Result } from '@/lib/services/result'

export interface AuditFilters {
  userId?: number
  action?: string
  from?: string
  to?: string
}

export interface AuditRow {
  id: number | null
  userId: number | null
  userName: string | null
  action: string | null
  entityId: number | null
  details: string | null
  createdAt: Date | null
}

const buildConditions = (filters: AuditFilters) => {
  const conditions = []
  if (filters.userId) conditions.push(eq(auditLog.userId, filters.userId))
  if (filters.action) conditions.push(ilike(auditLog.action, `%${filters.action}%`))
  if (filters.from) {
    const d = new Date(filters.from)
    if (!isNaN(d.getTime())) conditions.push(gte(auditLog.createdAt, d))
  }
  if (filters.to) {
    const d = new Date(`${filters.to}T23:59:59Z`)
    if (!isNaN(d.getTime())) conditions.push(lte(auditLog.createdAt, d))
  }
  return conditions
}

export const listAuditLog = async (
  filters: AuditFilters,
  page: number,
  pageSize = 50,
): Promise<Result<{ rows: AuditRow[]; total: number }>> => {
  const conditions = buildConditions(filters)
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined
  const clampedPageSize = Math.min(pageSize, 200)

  const [countResult, rows] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(auditLog)
      .where(whereClause),
    db
      .select({
        id: auditLog.id,
        userId: auditLog.userId,
        userName: users.name,
        action: auditLog.action,
        entityId: auditLog.entityId,
        details: auditLog.details,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.userId, users.id))
      .where(whereClause)
      .orderBy(sql`${auditLog.createdAt} DESC`)
      .limit(clampedPageSize)
      .offset((page - 1) * clampedPageSize),
  ])

  return ok({ rows: rows as AuditRow[], total: countResult[0]?.count ?? 0 })
}

export const exportAuditLog = async (filters: AuditFilters): Promise<Result<AuditRow[]>> => {
  const conditions = buildConditions(filters)
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db
    .select({
      id: auditLog.id,
      userId: auditLog.userId,
      userName: users.name,
      action: auditLog.action,
      entityId: auditLog.entityId,
      details: auditLog.details,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(whereClause)
    .orderBy(sql`${auditLog.createdAt} ASC`)

  return ok(rows as AuditRow[])
}
