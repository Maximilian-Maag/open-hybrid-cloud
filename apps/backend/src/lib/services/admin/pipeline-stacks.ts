import { db } from '@/lib/db/client'
import { pipelineStacks } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'
import { logAudit, changedFields } from '@/lib/audit'
import { isEmptyUpdate, EMPTY_UPDATE_MESSAGE } from '@/lib/services/updates'
import type { PipelineStack, CreatePipelineStackRequest, UpdatePipelineStackRequest } from '@open-hybrid-cloud/types'

const publicColumns = {
  id: pipelineStacks.id,
  productId: pipelineStacks.productId,
  environmentId: pipelineStacks.environmentId,
  name: pipelineStacks.name,
  stateKeyParam: pipelineStacks.stateKeyParam,
  steps: pipelineStacks.steps,
}

export const listPipelineStacks = async (productId: number): Promise<Result<PipelineStack[]>> => {
  const rows = await db
    .select(publicColumns)
    .from(pipelineStacks)
    .where(eq(pipelineStacks.productId, productId))

  return ok(rows as PipelineStack[])
}

export const createPipelineStack = async (
  productId: number,
  input: CreatePipelineStackRequest,
  actorId?: number,
): Promise<Result<PipelineStack>> => {
  const [row] = await db
    .insert(pipelineStacks)
    .values({
      productId,
      environmentId: input.environmentId,
      name: input.name,
      stateKeyParam: input.stateKeyParam ?? 'hostname',
      steps: input.steps,
    })
    .returning(publicColumns)

  await logAudit(
    actorId ?? null,
    'pipeline_stack.created',
    productId,
    `Stack ${input.name} (#${row.id}) for environment #${input.environmentId} with ${input.steps.length} step(s)`,
  )

  return ok(row as PipelineStack)
}

export const updatePipelineStack = async (
  productId: number,
  stackId: number,
  input: UpdatePipelineStackRequest,
  actorId?: number,
): Promise<Result<PipelineStack>> => {
  if (isEmptyUpdate(input)) return err(400, EMPTY_UPDATE_MESSAGE)

  const [updated] = await db
    .update(pipelineStacks)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.stateKeyParam !== undefined && { stateKeyParam: input.stateKeyParam }),
      ...(input.steps !== undefined && { steps: input.steps }),
    })
    .where(and(eq(pipelineStacks.id, stackId), eq(pipelineStacks.productId, productId)))
    .returning(publicColumns)

  if (!updated) return err(404, 'Not found')

  await logAudit(
    actorId ?? null,
    'pipeline_stack.updated',
    productId,
    `Stack #${stackId}: ${changedFields(input)}`,
  )

  return ok(updated as PipelineStack)
}

export const deletePipelineStack = async (
  productId: number,
  stackId: number,
  actorId?: number,
): Promise<Result<void>> => {
  const deleted = await db
    .delete(pipelineStacks)
    .where(and(eq(pipelineStacks.id, stackId), eq(pipelineStacks.productId, productId)))
    .returning({ id: pipelineStacks.id })

  if (!deleted.length) return err(404, 'Not found')

  await logAudit(actorId ?? null, 'pipeline_stack.deleted', productId, `Stack #${stackId} deleted`)

  return ok(undefined)
}
