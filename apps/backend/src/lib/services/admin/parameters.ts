import { db } from '@/lib/db/client'
import { parameters, products, productEnvironments, type Parameter } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'
import { recordProductVersion } from '@/lib/services/versions'
import { logAudit, changedFields } from '@/lib/audit'
import { isEmptyUpdate, EMPTY_UPDATE_MESSAGE } from '@/lib/services/updates'

export interface ParameterFilters {
  scope?: 'global' | 'category' | 'product'
  scopeId?: number
}

export interface CreateParameterInput {
  scope: 'global' | 'category' | 'product'
  scopeId?: number
  environmentId?: number | null
  name: string
  label?: string
  type: 'string' | 'number' | 'bool' | 'dropdown'
  description?: string
  defaultValue?: string
  required?: boolean
  sensitive?: boolean
}

export interface UpdateParameterInput {
  name?: string
  label?: string
  type?: 'string' | 'number' | 'bool' | 'dropdown'
  description?: string
  defaultValue?: string
  required?: boolean
  sensitive?: boolean
  environmentId?: number | null
}

export const listParameters = async (filters: ParameterFilters): Promise<Result<Parameter[]>> => {
  const conditions = []
  if (filters.scope) conditions.push(eq(parameters.scope, filters.scope))
  if (filters.scopeId !== undefined) conditions.push(eq(parameters.scopeId, filters.scopeId))

  const rows = await db
    .select()
    .from(parameters)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(parameters.scope, parameters.scopeId, parameters.name)

  return ok(rows)
}

export const createParameter = async (
  input: CreateParameterInput,
  userId?: number,
): Promise<Result<Parameter>> => {
  const [param] = await db
    .insert(parameters)
    .values({
      scope: input.scope,
      scopeId: input.scopeId ?? 0,
      environmentId: input.environmentId ?? null,
      name: input.name,
      label: input.label ?? '',
      type: input.type,
      description: input.description ?? '',
      defaultValue: input.defaultValue ?? '',
      required: input.required ?? false,
      sensitive: input.sensitive ?? false,
    })
    .returning()

  await recordParameterChange(param, 'added', userId ?? null)
  // `sensitive` is called out by name: it decides whether the value this parameter
  // carries is redacted everywhere downstream, so flipping it is a security event.
  await logAudit(
    userId ?? null,
    'parameter.created',
    param.id,
    `Created ${param.scope} parameter ${param.name}${param.sensitive ? ' (sensitive)' : ''}`,
  )
  return ok(param)
}

export const updateParameter = async (
  id: number,
  input: UpdateParameterInput,
  userId?: number,
): Promise<Result<Parameter>> => {
  if (isEmptyUpdate(input)) return err(400, EMPTY_UPDATE_MESSAGE)

  // Read the row first: an edit that MOVES the parameter to another environment
  // changes two sets of offerings, and the old one is only knowable from before.
  const [before] = await db.select().from(parameters).where(eq(parameters.id, id)).limit(1)

  const [updated] = await db
    .update(parameters)
    .set(input)
    .where(eq(parameters.id, id))
    .returning()

  if (!updated) return err(404, 'Not found')

  await recordParameterChange(updated, 'updated', userId ?? null)
  if (before && before.environmentId !== updated.environmentId) {
    await recordParameterChange(before, 'removed', userId ?? null)
  }

  // Field names, plus the new state of `sensitive` when that is what moved: a
  // parameter turned non-sensitive stops being redacted in every order, infra
  // element and snapshot that renders it, and nothing else in the system says so.
  const sensitiveNote =
    input.sensitive !== undefined ? ` (sensitive now ${updated.sensitive})` : ''
  await logAudit(
    userId ?? null,
    'parameter.updated',
    id,
    `${changedFields(input)}${sensitiveNote}`,
  )

  return ok(updated)
}

export const deleteParameter = async (id: number, userId?: number): Promise<Result<void>> => {
  const deleted = await db
    .delete(parameters)
    .where(eq(parameters.id, id))
    .returning()

  if (!deleted.length) return err(404, 'Not found')

  await recordParameterChange(deleted[0], 'removed', userId ?? null)
  await logAudit(
    userId ?? null,
    'parameter.deleted',
    id,
    `Deleted ${deleted[0].scope} parameter ${deleted[0].name}`,
  )
  return ok(undefined)
}

/**
 * Record a catalogue version on every offering a parameter change affects
 * (issue #38).
 *
 * Parameter definitions are part of the offering snapshot, so without this a
 * change to one — its default, whether it is required, whether it is sensitive —
 * left no version to compare against and quietly folded itself into whatever
 * unrelated edit happened to be recorded next.
 *
 * One version per affected OFFERING rather than per product, because that is the
 * granularity a snapshot has. The fan-out is therefore the number of offerings in
 * the parameter's scope: one product's for 'product', a category's for 'category',
 * the catalogue's for 'global'. Best-effort, like the recorder itself — a change to
 * a parameter must not fail because its history could not be written.
 */
const recordParameterChange = async (
  param: { scope: string; scopeId: number; environmentId: number | null; name: string },
  action: 'added' | 'updated' | 'removed',
  userId: number | null,
): Promise<void> => {
  try {
    const conditions = []
    if (param.scope === 'product') conditions.push(eq(productEnvironments.productId, param.scopeId))
    if (param.scope === 'category') conditions.push(eq(products.categoryId, param.scopeId))
    // A parameter pinned to one environment only changes that offering; an
    // environment-agnostic one changes every offering of the products in scope.
    if (param.environmentId !== null) {
      conditions.push(eq(productEnvironments.environmentId, param.environmentId))
    }

    const offerings = await db
      .select({
        productId: productEnvironments.productId,
        environmentId: productEnvironments.environmentId,
      })
      .from(productEnvironments)
      .innerJoin(products, eq(productEnvironments.productId, products.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)

    for (const offering of offerings) {
      await recordProductVersion({
        productId: offering.productId,
        environmentId: offering.environmentId,
        summary: `Parameter ${param.name} ${action}`,
        userId,
      })
    }
  } catch (e) {
    console.error('[parameters] Failed to record a version for a parameter change:', e)
  }
}
