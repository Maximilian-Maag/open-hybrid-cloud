-- Free-text discussion on an order (issue #34).
--
-- The rejection note already proved a note can be stored per order; this
-- generalises it into a thread, with an internal flag for notes only admins see.
CREATE TABLE IF NOT EXISTS "order_comments" (
  "id"         BIGSERIAL PRIMARY KEY,
  "order_id"   BIGINT NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  -- No ON DELETE on the author: a comment must not lose its attribution.
  -- Deactivating a user is how they are retired, and the audit trail depends on
  -- knowing who said what.
  "user_id"    BIGINT NOT NULL REFERENCES "users"("id"),
  "body"       TEXT NOT NULL,
  -- Visible to admin/root only. Every read path filters on this; the UI hiding it
  -- would not be a control.
  "internal"   BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Separate from created_at so an edited comment can be shown as edited rather
  -- than silently rewritten under a reader who already replied to it.
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every read is "the thread for one order, oldest first".
CREATE INDEX IF NOT EXISTS "order_comments_order_idx"
  ON "order_comments" ("order_id", "created_at");
