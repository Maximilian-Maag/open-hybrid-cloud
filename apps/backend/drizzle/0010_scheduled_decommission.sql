-- Automatic teardown at a future instant (issue #30).
--
-- Temporary environments (test, demo, PoC) are otherwise forgotten and keep
-- accruing cost. NULL means "no schedule" — the only honest way to express
-- "never", since a sentinel far-future date would eventually arrive.
ALTER TABLE "infrastructure_elements"
  ADD COLUMN IF NOT EXISTS "scheduled_decommission_at" TIMESTAMPTZ;

-- The sweep asks one question on every run: which ACTIVE elements are due? A
-- partial index keeps that a bounded scan over the scheduled minority instead of
-- a full table scan, and excludes the NULL majority entirely.
CREATE INDEX IF NOT EXISTS "infrastructure_elements_due_decommission_idx"
  ON "infrastructure_elements" ("scheduled_decommission_at")
  WHERE "scheduled_decommission_at" IS NOT NULL AND "status" = 'active';
