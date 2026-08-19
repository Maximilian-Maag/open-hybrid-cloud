-- Per-user product bookmarks (issue #39).
--
-- Composite primary key rather than a surrogate id: a user can favourite a
-- product once, and that uniqueness is also exactly the lookup the catalogue
-- needs, so there is no separate index to maintain and no way to store a
-- duplicate in the first place.
--
-- Both foreign keys cascade: a favourite is meaningless once either the user or
-- the product is gone, and leaving orphans behind would have the catalogue
-- filtering against ids that no longer resolve.
CREATE TABLE IF NOT EXISTS "product_favorites" (
  "user_id"    BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "product_id" BIGINT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("user_id", "product_id")
);
