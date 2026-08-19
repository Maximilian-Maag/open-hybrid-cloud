-- Shopping cart (issue #28).
--
-- A separate table rather than orders in a 'draft' status: a cart item has no
-- project, no validated parameters and no cost centre, so living in `orders` would
-- mean every query over orders had to remember to exclude drafts — and a draft
-- would show up in an approval queue or an audit export the first time someone
-- forgot a WHERE clause.
CREATE TABLE IF NOT EXISTS "cart_items" (
  "id"             BIGSERIAL PRIMARY KEY,
  "user_id"        BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "product_id"     BIGINT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "environment_id" BIGINT NOT NULL REFERENCES "deployment_environments"("id") ON DELETE CASCADE,
  -- Whatever the user had typed when they added the item, stored unvalidated: a
  -- cart is a shopping list, and refusing to hold an incomplete item would defeat
  -- the point of collecting first and filling in at checkout.
  "parameters"     JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every read is "this user's cart, in the order they added things".
CREATE INDEX IF NOT EXISTS "cart_items_user_idx" ON "cart_items" ("user_id", "created_at");
