-- Time-boxed trials (issue #1).
--
-- Opt-in per offering rather than catalogue-wide: a trial provisions real
-- infrastructure and asks the pipeline to grant elevated rights inside it, which
-- is not something every product should hand out. Default FALSE so the migration
-- changes no existing behaviour.
ALTER TABLE "product_environments"
  ADD COLUMN IF NOT EXISTS "trial_enabled" BOOLEAN NOT NULL DEFAULT FALSE;

-- 30 minutes is the issue's number, kept as a default rather than a constant so a
-- heavier app can be given longer.
ALTER TABLE "product_environments"
  ADD COLUMN IF NOT EXISTS "trial_duration_minutes" INTEGER NOT NULL DEFAULT 30;

-- On the order, not just applied at creation: a project manager's order is
-- provisioned at APPROVAL, which is where the trial clock starts and where the
-- trial variables reach CI. Without this the intent would be lost in between.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "is_trial" BOOLEAN NOT NULL DEFAULT FALSE;
