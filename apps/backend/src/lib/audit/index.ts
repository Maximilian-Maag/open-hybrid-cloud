import { db } from '@/lib/db/client'
import { auditLog } from '@/lib/db/schema'

/**
 * Append one entry to the audit log (FA-14).
 *
 * `action` is `entity.verb_in_snake_case` — `order.created`, `order.comment_added`,
 * `infra.decommission_scheduled` — and the entity prefix is the table the entity
 * lives in, singular: `user`, `cost_center`, `ci_source`, `environment`,
 * `parameter`, `category`, `product`, `pipeline_stack`, `config`, `branding`.
 * The prefix is what makes the log's `action` filter useful, so it matters more
 * than the exact verb.
 *
 * `details` records WHICH FIELDS CHANGED, NEVER THEIR VALUES. Decided once for
 * the whole admin surface (issue #137) and it is not a style preference: the
 * mutating admin endpoints carry a CI access token, an SMTP password, an AI API
 * key and a webhook callback secret, and NFA-04.3 makes this table append-only —
 * so a value written here can never be redacted afterwards, and an audit log that
 * an admin may read would become the easiest place in the system to harvest
 * credentials. `changedFields` builds the safe form; use it rather than
 * interpolating an input object.
 */
export const logAudit = (
  userId: number | null,
  action: string,
  entityId?: number,
  details?: string,
) => logAuditWith(db, userId, action, entityId, details)

type Db = typeof db
/** The handle a `db.transaction` callback receives. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * `logAudit` against a specific executor.
 *
 * The deletes that pre-check their references do so inside a transaction, and the
 * entry recording the delete has to be written on the same connection — written
 * through the pool instead it would survive a rollback and claim a delete that
 * never happened.
 */
export const logAuditWith = (
  executor: Db | Tx,
  userId: number | null,
  action: string,
  entityId?: number,
  details?: string,
) =>
  (executor as Db).insert(auditLog).values({
    userId,
    action,
    entityId: entityId ?? null,
    details: details ?? '',
  })

/**
 * The names of the fields an update actually named, as a `details` string.
 *
 * Names only — see the policy on `logAudit`. `sensitive` on a parameter, a CI
 * source's `accessToken`, the SMTP `password`: the fact that one of them was
 * changed is the auditable event, and the new value is not the log's business.
 */
export const changedFields = (input: object): string => {
  const names = Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name)
    .sort()
  return names.length > 0 ? `Changed: ${names.join(', ')}` : 'No fields changed'
}
