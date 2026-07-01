import { db } from '@/lib/db/client'
import { costCenters, type CostCenter } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'

export interface CreateCostCenterInput {
  code: string
  name: string
  active?: boolean
}

export interface UpdateCostCenterInput {
  code?: string
  name?: string
  active?: boolean
}

export const listCostCenters = async (): Promise<Result<CostCenter[]>> => {
  const rows = await db
    .select()
    .from(costCenters)
    .orderBy(costCenters.code)

  return ok(rows)
}

export const createCostCenter = async (input: CreateCostCenterInput): Promise<Result<CostCenter>> => {
  const [cc] = await db
    .insert(costCenters)
    .values({ code: input.code, name: input.name, active: input.active ?? true })
    .returning()

  return ok(cc)
}

export const getCostCenterById = async (id: number): Promise<Result<CostCenter>> => {
  const rows = await db
    .select()
    .from(costCenters)
    .where(eq(costCenters.id, id))
    .limit(1)

  if (!rows.length) return err(404, 'Not found')
  return ok(rows[0])
}

export const updateCostCenter = async (
  id: number,
  input: UpdateCostCenterInput,
): Promise<Result<CostCenter>> => {
  const [updated] = await db
    .update(costCenters)
    .set(input)
    .where(eq(costCenters.id, id))
    .returning()

  if (!updated) return err(404, 'Not found')
  return ok(updated)
}

export const deleteCostCenter = async (id: number): Promise<Result<void>> => {
  const deleted = await db
    .delete(costCenters)
    .where(eq(costCenters.id, id))
    .returning({ id: costCenters.id })

  if (!deleted.length) return err(404, 'Not found')
  return ok(undefined)
}
