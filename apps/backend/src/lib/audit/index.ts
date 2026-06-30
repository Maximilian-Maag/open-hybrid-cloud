import { db } from '@/lib/db/client'
import { auditLog } from '@/lib/db/schema'

export const logAudit = (
  userId: number | null,
  action: string,
  entityId?: number,
  details?: string,
) =>
  db.insert(auditLog).values({
    userId,
    action,
    entityId: entityId ?? null,
    details: details ?? '',
  })
