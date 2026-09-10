-- Drift reporting (#108), inverted: the CI reports, the portal records.
--
-- #108 proposed the portal triggering a refresh pipeline per element every
-- thirty minutes. That needed refresh-specific pipeline tracking (the existing
-- `pipeline_id` is already two-phase-owned by provisioning and teardown), a
-- third match branch in the webhook handler (a refreshing element stays
-- 'active' and matches neither existing predicate), and log scraping to recover
-- `-detailed-exitcode` (GitLab flattens it to success/failed). A single
-- scheduled pipeline that POSTs its findings needs none of the three.
--
-- So there is no new trigger and no new tracking of outbound pipelines here.
-- What is added is somewhere to put an answer that arrives on its own.

-- Nullable on purpose, all four. NULL means "never heard", which is a different
-- thing from "checked and clean" and has to stay distinguishable — an element
-- whose reports stopped arriving must not read as healthy. That confusion is
-- the same one #108 opens with: `active` meaning "we once started a pipeline".
ALTER TABLE "infrastructure_elements" ADD COLUMN IF NOT EXISTS "last_refreshed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "infrastructure_elements" ADD COLUMN IF NOT EXISTS "last_refresh_outcome" text;
--> statement-breakpoint
-- Set when drift is found, cleared when a later report comes back clean, so it
-- always describes the CURRENT drift rather than the last drift ever seen.
ALTER TABLE "infrastructure_elements" ADD COLUMN IF NOT EXISTS "drift_detected_at" timestamptz;
--> statement-breakpoint
-- Resource addresses and change kinds, as the reporting pipeline saw them.
ALTER TABLE "infrastructure_elements" ADD COLUMN IF NOT EXISTS "drift_summary" jsonb;
--> statement-breakpoint

ALTER TABLE "infrastructure_elements" ADD CONSTRAINT "infrastructure_elements_refresh_outcome"
  CHECK ("last_refresh_outcome" IS NULL OR "last_refresh_outcome" IN ('clean', 'drifted', 'locked', 'error'));
--> statement-breakpoint

-- Terraform states in the backend that no element claims.
--
-- NOT the same thing as #109. #109 is about resources created outside Terraform
-- altogether, which no state file mentions and which tagging would be needed to
-- find. This is the narrower, genuinely detectable case: a state file the
-- reporting pipeline can see and the portal cannot account for — an element
-- deleted from the portal while its infrastructure stayed up, or a stack
-- renamed. Useful, and worth not confusing with the other.
CREATE TABLE IF NOT EXISTS "unclaimed_states" (
  "state_key"     text PRIMARY KEY,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at"  timestamptz NOT NULL DEFAULT now(),
  "outcome"       text,
  "summary"       jsonb,
  CONSTRAINT "unclaimed_states_outcome" CHECK ("outcome" IS NULL OR "outcome" IN ('clean', 'drifted', 'locked', 'error'))
);
--> statement-breakpoint

-- When the portal last heard from the reporting pipeline at all.
--
-- Per-element timestamps cannot answer this: if the pipeline stops running,
-- every element simply stops being updated and nothing anywhere says why. One
-- row, like `app_config` and `branding`.
CREATE TABLE IF NOT EXISTS "drift_report_state" (
  "id"                 integer PRIMARY KEY DEFAULT 1,
  "last_report_at"     timestamptz,
  "elements_reported"  integer NOT NULL DEFAULT 0,
  "unclaimed_reported" integer NOT NULL DEFAULT 0,
  CONSTRAINT "drift_report_state_singleton" CHECK ("id" = 1)
);
--> statement-breakpoint

INSERT INTO "drift_report_state" ("id") VALUES (1) ON CONFLICT DO NOTHING;
