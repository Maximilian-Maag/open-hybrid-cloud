-- Retiring a product must not erase what was ordered from it (issue #142).
--
-- `orders.product_id` is ON DELETE CASCADE, so deleting a product deleted every
-- order placed for it — and with them `orders.product_snapshot`, the column added
-- in 0013 for the sole purpose of making an order's terms survive a later
-- catalogue change. The delete erased the record it was designed to protect.
--
-- Refusing the delete outright was the obvious alternative and does not work here:
-- `infrastructure_elements.order_id` is NOT NULL, so every product that has ever
-- been provisioned has an order, and refusing would make FA-09.6 (cascade
-- decommissioning on product delete) unreachable in exactly the case it exists
-- for. So a product that has been ordered is RETIRED instead: the row stays as the
-- referent its orders need, and the service withdraws every environment offering
-- so nothing can be ordered from it again.
--
-- Nullable, with no backfill: NULL means "in the catalogue", which is what every
-- existing product is.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "retired_at" timestamp with time zone;

-- Partial index: every catalogue read filters on `retired_at IS NULL`, and
-- retired rows are the rare ones, so the index only has to cover the live set.
CREATE INDEX IF NOT EXISTS "products_live_idx" ON "products" ("id") WHERE "retired_at" IS NULL;

-- Categories need the same treatment, one level up. `products.category_id` is ON
-- DELETE CASCADE, so deleting a category deleted its products and cascaded their
-- orders away too — the same erasure, reached one step earlier. A category whose
-- products have been ordered is therefore retired alongside them, which keeps it
-- available as the `category_id` those retired rows still point at while removing
-- it from every list. A category whose products were never ordered is still
-- deleted outright, products and all.
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "retired_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "categories_live_idx" ON "categories" ("id") WHERE "retired_at" IS NULL;
