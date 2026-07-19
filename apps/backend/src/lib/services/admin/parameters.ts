import { db } from '@/lib/db/client'
import { parameters, type Parameter } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'

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

export const createParameter = async (input: CreateParameterInput): Promise<Result<Parameter>> => {
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

  return ok(param)
}

export const updateParameter = async (
  id: number,
  input: UpdateParameterInput,
): Promise<Result<Parameter>> => {
  const [updated] = await db
    .update(parameters)
    .set(input)
    .where(eq(parameters.id, id))
    .returning()

  if (!updated) return err(404, 'Not found')
  return ok(updated)
}

export const deleteParameter = async (id: number): Promise<Result<void>> => {
  const deleted = await db
    .delete(parameters)
    .where(eq(parameters.id, id))
    .returning({ id: parameters.id })

  if (!deleted.length) return err(404, 'Not found')
  return ok(undefined)
}
