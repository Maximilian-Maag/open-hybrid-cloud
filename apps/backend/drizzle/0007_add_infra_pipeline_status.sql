-- Per-pipeline terminal status for an infrastructure element's decommission
-- run, keyed by pipeline id — the same shape as orders.pipeline_status
-- (migration 0005).
--
-- A teardown fans out to every product webhook AND every pipeline stack
-- configured for the product/environment, so decommissioning can be waiting on
-- more than one pipeline. Without a per-pipeline map the callback handler
-- flipped the element to 'decommissioned' on the FIRST matching success and
-- then ignored its siblings (the row is no longer 'decommissioning'), reporting
-- a completed teardown while another stack was still running or had failed.
ALTER TABLE "infrastructure_elements"
  ADD COLUMN IF NOT EXISTS "pipeline_status" JSONB NOT NULL DEFAULT '{}'::jsonb;
