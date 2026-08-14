-- Track the terminal status of each pipeline that belongs to an order.
--
-- Previously an order was marked 'completed' as soon as ANY one of its
-- pipeline ids reported success, and a later failure of another pipeline was
-- silently dropped. For products whose provisioning fans out into several
-- pipelines (product webhooks + pipeline stacks) this reported success while
-- infrastructure was still failing.
--
-- This column records success/failed/canceled per pipeline id so the webhook
-- handler can complete the order only once EVERY pipeline in orders.pipeline_id
-- has succeeded, and fail it as soon as any single pipeline fails or is
-- canceled.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "pipeline_status" JSONB NOT NULL DEFAULT '{}'::jsonb;
