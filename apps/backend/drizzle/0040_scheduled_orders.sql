-- An approved order can wait for a deployment window (#330).
--
-- The window arithmetic and the tables it reads landed already; this is the
-- state an order sits in between "an admin approved it" and "a window opened".
--
-- No change to the `status` column itself: it is `text` with a Drizzle enum, so
-- 'scheduled' is a TypeScript widening rather than a database one. Deliberate
-- consistency with how every other status was added, not an oversight.

-- When the window that will release it opens. NULL for every order that is not
-- waiting, which is all of them today.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "scheduled_for" timestamptz;
--> statement-breakpoint

-- Root can deploy now anyway, and who did it is the point of recording it.
-- Nullable because the ordinary case is nobody overrode anything.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "window_override_by" bigint REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "window_override_at" timestamptz;
--> statement-breakpoint

-- Only a scheduled order has a time to be released at, and only a released one
-- has an overrider. A row that carries either without the other is a bug that
-- would otherwise surface as an order the sweep picks up for ever.
ALTER TABLE "orders" ADD CONSTRAINT "orders_scheduled_consistency"
  CHECK (
    ("scheduled_for" IS NULL OR "status" IN ('scheduled', 'provisioning', 'completed', 'failed'))
    AND ("window_override_by" IS NULL) = ("window_override_at" IS NULL)
  );
--> statement-breakpoint

-- The sweep asks one question every time it runs: which scheduled orders are
-- due? Without this it is a sequential scan of every order ever placed.
CREATE INDEX IF NOT EXISTS "orders_scheduled_for_idx"
  ON "orders" ("scheduled_for") WHERE "status" = 'scheduled';
