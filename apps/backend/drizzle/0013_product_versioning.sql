-- Product versioning and changelog (issue #38).

-- What the customer was actually offered when the order was placed.
--
-- Orders reference the product by id, so without this a later price change or a
-- removed parameter silently rewrites history: the order detail page would show
-- today's configuration as though it were the one that was approved.
--
-- Nullable, and deliberately not backfilled: orders placed before this column
-- existed have no snapshot, and inventing one from today's catalogue would be
-- exactly the lie the column exists to prevent.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "product_snapshot" JSONB;

-- Timeline of catalogue changes, so the history explains what an existing order's
-- snapshot differs FROM.
CREATE TABLE IF NOT EXISTS "product_versions" (
  "id"             BIGSERIAL PRIMARY KEY,
  "product_id"     BIGINT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  -- Null for a change to the product itself (name, description, category), which
  -- is not specific to one environment.
  "environment_id" BIGINT REFERENCES "deployment_environments"("id") ON DELETE SET NULL,
  "changelog"      TEXT NOT NULL DEFAULT '',
  "summary"        TEXT NOT NULL DEFAULT '',
  "snapshot"       JSONB,
  -- No ON DELETE on the author: a version entry that loses its attribution stops
  -- being a history.
  "created_by"     BIGINT REFERENCES "users"("id"),
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every read is "the history for one product, newest first".
CREATE INDEX IF NOT EXISTS "product_versions_product_idx"
  ON "product_versions" ("product_id", "created_at" DESC);
