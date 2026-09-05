-- Deployment windows: when provisioning is allowed to run (#330).
--
-- The shape follows the operator's own description of the feature: how many
-- windows a day, when each starts, and how long it lasts. The same pattern
-- every working day, so there is no weekday column — weekends fall out of the
-- calendar and holidays out of the table below.

CREATE TABLE IF NOT EXISTS "deployment_windows" (
  "id"               bigserial PRIMARY KEY,
  -- Minutes past local midnight, in the zone `app_config.deployment_time_zone`
  -- names. 08:00 is 480. Stored as a number rather than a `time` because it is
  -- arithmetic, not an instant: a `time` invites a reader to think it carries a
  -- zone, and the whole difficulty here is that it does not.
  "start_minute"     integer NOT NULL,
  "duration_minutes" integer NOT NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  -- A window must fall inside one day. One that runs past midnight is two
  -- windows on two different days, and the second may be a Saturday — which the
  -- service layer cannot express and an operator would not expect.
  CONSTRAINT "deployment_windows_within_day" CHECK (
    "start_minute" >= 0 AND "start_minute" <= 1439
    AND "duration_minutes" > 0
    AND "start_minute" + "duration_minutes" <= 1440
  )
);
--> statement-breakpoint

-- Non-working days, resolved from the configured feed and cached here.
--
-- Cached rather than fetched on the decision path, deliberately: deciding
-- whether an order may deploy must not depend on a third party answering. A
-- refresh that fails leaves the last good set in place; see
-- `holiday_feed_state` for how staleness is surfaced.
CREATE TABLE IF NOT EXISTS "holidays" (
  -- A local date in the deployment time zone, not an instant.
  "date"     date PRIMARY KEY,
  "name"     text NOT NULL,
  -- 'feed' rows are replaced wholesale by a refresh; 'manual' rows survive it,
  -- which is what makes a company shutdown no public feed knows about, and a
  -- public holiday the company works through, both expressible.
  "source"   text NOT NULL DEFAULT 'feed',
  -- A 'manual' row that switches this off is how a holiday is un-observed.
  "observed" boolean NOT NULL DEFAULT true,
  CONSTRAINT "holidays_source" CHECK ("source" IN ('feed', 'manual'))
);
--> statement-breakpoint

-- What the feed did last, so the admin UI can say how old the answer is.
--
-- A single row, like `app_config`: there is one feed.
CREATE TABLE IF NOT EXISTS "holiday_feed_state" (
  "id"               integer PRIMARY KEY DEFAULT 1,
  "url"              text,
  "last_success_at"  timestamptz,
  "last_error"       text,
  "last_error_at"    timestamptz,
  CONSTRAINT "holiday_feed_state_singleton" CHECK ("id" = 1)
);
--> statement-breakpoint

INSERT INTO "holiday_feed_state" ("id") VALUES (1) ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- The zone the windows are read in. One per deployment, next to the rest of the
-- portal's configuration.
--
-- NOT NULL with a default because every existing row needs a value and there is
-- a right one: windows mean nothing without a zone, and UTC is the only
-- defensible guess before an operator has said otherwise.
ALTER TABLE "app_config" ADD COLUMN IF NOT EXISTS "deployment_time_zone" text NOT NULL DEFAULT 'UTC';
--> statement-breakpoint

-- Per-environment opt-in, default OFF.
--
-- Off is the only safe default on an upgrade: switching this on globally would
-- stop every sandbox deploy after 18:00 for deployments that never asked for
-- windows at all.
ALTER TABLE "deployment_environments" ADD COLUMN IF NOT EXISTS "respects_deployment_windows" boolean NOT NULL DEFAULT false;
