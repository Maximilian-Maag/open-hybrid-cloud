import { db } from '@/lib/db/client'
import { pipelineStacks } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { ok, err } from '@/lib/services/result'
import type { Result } from '@/lib/services/result'
import type { PipelineStack, CreatePipelineStackRequest, UpdatePipelineStackRequest } from '@open-hybrid-cloud/types'

export const listPipelineStacks = async (productId: number): Promise<Result<PipelineStack[]>> => {
  const rows = await db
    .select()
    .from(pipelineStacks)
    .where(eq(pipelineStacks.productId, productId))

  return ok(rows as PipelineStack[])
}

export const createPipelineStack = async (
  productId: number,
  input: CreatePipelineStackRequest,
): Promise<Result<PipelineStack>> => {
  const [row] = await db
    .insert(pipelineStacks)
    .values({
      productId,
      environmentId: input.environmentId,
      name: input.name,
      webhookUrl: input.webhookUrl,
      webhookToken: input.webhookToken,
      stateKeyParam: input.stateKeyParam ?? 'hostname',
      steps: input.steps,
    })
    .returning()

  return ok(row as PipelineStack)
}

export const updatePipelineStack = async (
  productId: number,
  stackId: number,
  input: UpdatePipelineStackRequest,
): Promise<Result<PipelineStack>> => {
  const [updated] = await db
    .update(pipelineStacks)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.webhookUrl !== undefined && { webhookUrl: input.webhookUrl }),
      ...(input.webhookToken !== undefined && { webhookToken: input.webhookToken }),
      ...(input.stateKeyParam !== undefined && { stateKeyParam: input.stateKeyParam }),
      ...(input.steps !== undefined && { steps: input.steps }),
    })
    .where(and(eq(pipelineStacks.id, stackId), eq(pipelineStacks.productId, productId)))
    .returning()

  if (!updated) return err(404, 'Not found')
  return ok(updated as PipelineStack)
}

export const deletePipelineStack = async (productId: number, stackId: number): Promise<Result<void>> => {
  const deleted = await db
    .delete(pipelineStacks)
    .where(and(eq(pipelineStacks.id, stackId), eq(pipelineStacks.productId, productId)))
    .returning({ id: pipelineStacks.id })

  if (!deleted.length) return err(404, 'Not found')
  return ok(undefined)
}
