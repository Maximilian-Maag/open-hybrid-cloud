import type { SessionUser } from '@open-hybrid-cloud/types'
import { db } from '@/lib/db/client'
import { projects, users, costCenters, infrastructureElements, orders, type Project } from '@/lib/db/schema'
import { eq, sql, and, count, isNull } from 'drizzle-orm'
import { countWhere } from '@/lib/db/queries'
import { logAudit, logAuditWith, changedFields } from '@/lib/audit'
import { ok, err, type Result } from '@/lib/services/result'
import { fireDestroyTriggers, destroyVariables } from '@/lib/services/teardown'
import { isEmptyUpdate, EMPTY_UPDATE_MESSAGE } from '@/lib/services/updates'

export interface ProjectRow {
  id: number
  name: string
  description: string
  ownerId: number
  costCenterId: number | null
  createdAt: Date
  ownerName: string | null
  costCenterName: string | null
}

export interface UpdateProjectInput {
  name?: string
  description?: string
  costCenterId?: number | null
}

/** Not retired — the condition every read of a project carries (issue #187). */
const inUse = isNull(projects.retiredAt)

export const listProjects = async (session: SessionUser): Promise<Result<ProjectRow[]>> => {
  const isAdmin = session.role === 'admin' || session.role === 'root'

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      ownerId: projects.ownerId,
      costCenterId: projects.costCenterId,
      createdAt: projects.createdAt,
      ownerName: users.name,
      costCenterName: costCenters.name,
    })
    .from(projects)
    .leftJoin(users, eq(projects.ownerId, users.id))
    .leftJoin(costCenters, eq(projects.costCenterId, costCenters.id))
    // A retired project (see `deleteProject`) was deleted as far as anyone using
    // the system is concerned; the row only survives so its orders keep theirs.
    .where(isAdmin ? inUse : and(eq(projects.ownerId, session.id), inUse))
    .orderBy(sql`${projects.createdAt} DESC`)

  return ok(rows as ProjectRow[])
}

export const getProjectById = async (
  session: SessionUser,
  projectId: number,
): Promise<Result<ProjectRow>> => {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      ownerId: projects.ownerId,
      costCenterId: projects.costCenterId,
      createdAt: projects.createdAt,
      ownerName: users.name,
      costCenterName: costCenters.name,
    })
    .from(projects)
    .leftJoin(users, eq(projects.ownerId, users.id))
    .leftJoin(costCenters, eq(projects.costCenterId, costCenters.id))
    .where(and(eq(projects.id, projectId), inUse))
    .limit(1)

  if (!rows.length) return err(404, 'Project not found')

  const project = rows[0] as ProjectRow
  if (session.role === 'project_manager' && project.ownerId !== session.id) {
    return err(403, 'Forbidden')
  }

  return ok(project)
}

export const createProject = async (
  session: SessionUser,
  input: { name: string; description?: string; costCenterId?: number },
): Promise<Result<Project>> => {
  const [project] = await db
    .insert(projects)
    .values({
      name: input.name,
      description: input.description ?? '',
      ownerId: session.id,
      costCenterId: input.costCenterId ?? null,
    })
    .returning()

  // Projects were the one mutating surface with no audit trail at all (issue
  // #187): #137 audited `services/admin/`, and these live a directory up.
  await logAudit(session.id, 'project.created', project.id, `Created project by ${session.email}`)

  return ok(project)
}

export const updateProject = async (
  session: SessionUser,
  projectId: number,
  input: UpdateProjectInput,
): Promise<Result<Project>> => {
  const existing = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(and(eq(projects.id, projectId), inUse))
    .limit(1)

  if (!existing.length) return err(404, 'Project not found')

  if (session.role === 'project_manager' && existing[0].ownerId !== session.id) {
    return err(403, 'Forbidden')
  }

  const update: Partial<UpdateProjectInput> = {}
  if (input.name !== undefined) update.name = input.name
  if (input.description !== undefined) update.description = input.description
  if (input.costCenterId !== undefined) update.costCenterId = input.costCenterId

  // A well-formed `{}` used to reach `.set({})`, where Drizzle's mapUpdateSet
  // throws "No values to set" — an unhandled 500 any project manager could hit on
  // their own project (issue #143). Checked after the ownership check so it cannot
  // be used to probe which projects exist.
  if (isEmptyUpdate(update)) return err(400, EMPTY_UPDATE_MESSAGE)

  const [updated] = await db
    .update(projects)
    .set(update)
    .where(eq(projects.id, projectId))
    .returning()

  // Field names only, never their values — the policy `logAudit` documents.
  await logAudit(session.id, 'project.updated', projectId, changedFields(update))

  return ok(updated)
}

export const deleteProject = async (
  session: SessionUser,
  projectId: number,
): Promise<Result<void>> => {
  // ownership check for PMs
  if (session.role === 'project_manager') {
    const existing = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(and(eq(projects.id, projectId), inUse))
      .limit(1)
    if (!existing.length) return err(404, 'Project not found')
    if (existing[0].ownerId !== session.id) return err(403, 'Forbidden')
  }

  // fire destroy webhooks for all active infra elements
  const activeInfra = await db
    .select({ id: infrastructureElements.id, orderId: infrastructureElements.orderId, productId: infrastructureElements.productId, environmentId: infrastructureElements.environmentId, parameters: infrastructureElements.parameters, sequence: infrastructureElements.sequence, sizeCode: infrastructureElements.sizeCode })
    .from(infrastructureElements)
    .where(and(eq(infrastructureElements.projectId, projectId), eq(infrastructureElements.status, 'active')))

  // Await the destroy trigger request BEFORE deleting the project. The delete
  // cascades to infrastructure_elements (ON DELETE CASCADE); firing the webhook
  // fire-and-forget raced the cascade. NOTE: awaiting only guarantees the CI
  // system accepted the trigger — the destroy pipeline still runs asynchronously
  // afterwards, so a late failure cannot be reconciled once the rows are gone.
  const triggerFailures: string[] = []
  for (const infra of activeInfra) {
    // Atomically claim the row (active → decommissioning) so two concurrent
    // deletes can't both fire a destroy pipeline for the same element.
    const claimed = await db
      .update(infrastructureElements)
      .set({ status: 'decommissioning' })
      .where(and(eq(infrastructureElements.id, infra.id), eq(infrastructureElements.status, 'active')))
      .returning({ id: infrastructureElements.id })
    if (!claimed.length) continue
    const destroyVars = destroyVariables(infra)
    try {
      // Fires destroy for BOTH product webhooks and pipeline stacks — stack-
      // provisioned infra would otherwise leak on project deletion.
      const outcome = await fireDestroyTriggers(infra, destroyVars)
      triggerFailures.push(...outcome.failures.map((f) => `infra #${infra.id}: ${f}`))
    } catch (e) {
      console.error(e)
      triggerFailures.push(`infra #${infra.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Block the delete when any destroy could not be started — the cascade would
  // remove the infrastructure_elements rows and leave the provisioned
  // infrastructure running with nothing left to reconcile it against. The
  // claimed rows keep their state, so the operator can fix the CI side and retry.
  if (triggerFailures.length > 0) {
    return err(
      502,
      `Cannot delete project: ${triggerFailures.length} destroy trigger(s) could not be started, so deleting now would leak infrastructure. Fix and retry — ${triggerFailures.join('; ')}`,
    )
  }

  /*
   * Retire-or-delete, deciding INSIDE the transaction that performs it — the shape
   * `deleteProduct` arrived at, for the same reason and one foreign key closer to
   * the damage.
   *
   * `orders.project_id` is ON DELETE CASCADE and `order_comments.order_id` cascades
   * from there, so a hard delete here took every order in the project, every
   * comment on it, and every `product_snapshot` — the record of what the customer
   * was actually charged — out of the spending dashboard, the CSV and the PDF
   * (issue #187).
   *
   * Counting before the destroy-trigger loop above would not do: those are network
   * calls to the CI system, seconds long, and the project stays fully orderable
   * throughout them. `FOR UPDATE` on the project row is what makes the count exact:
   * inserting an order takes a FOR KEY SHARE lock on the project it references,
   * which conflicts with FOR UPDATE, so a concurrent order either committed before
   * the lock and is counted, or waits behind it — and if this ends in a hard delete
   * its foreign key then fails, which refuses the order rather than destroying it.
   */
  return db.transaction(async (tx): Promise<Result<void>> => {
    const locked = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), inUse))
      .for('update')
      .limit(1)
    if (!locked.length) return err(404, 'Project not found')

    // Counted by Postgres rather than selected and measured: the audit entry below
    // quotes the figure, and a long-lived project has as many rows here as it has
    // ever had orders, none of which are otherwise read.
    const orderCount = await countWhere(tx.select({ n: count() }).from(orders).where(eq(orders.projectId, projectId)))

    if (orderCount > 0) {
      // The infrastructure_elements rows stay, unlike under the cascade: they were
      // claimed as `decommissioning` above and their destroy pipelines report back
      // to the callback that reconciles them. Deleting them is what left provisioned
      // infrastructure with nothing left to reconcile against.
      await tx.update(projects).set({ retiredAt: new Date() }).where(eq(projects.id, projectId))

      // On the transaction's own connection, so it rolls back with the retirement.
      await logAuditWith(
        tx,
        session.id,
        'project.retired',
        projectId,
        `Retired project (${orderCount} order(s) keep their history), decommissioning ${activeInfra.length} infrastructure element(s)`,
      )

      return ok(undefined)
    }

    await tx.delete(projects).where(eq(projects.id, projectId))

    await logAuditWith(
      tx,
      session.id,
      'project.deleted',
      projectId,
      `Deleted empty project, decommissioning ${activeInfra.length} infrastructure element(s)`,
    )

    return ok(undefined)
  })
}
