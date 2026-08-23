-- Deleting a project must not erase the orders placed into it (issue #187).
--
-- `orders.project_id` is ON DELETE CASCADE and `order_comments.order_id` cascades
-- from there, so deleting a project deleted every order in it — and with them
-- `orders.product_snapshot`, the column 0013 added so a catalogue edit cannot
-- rewrite what a customer was charged. `getCostReport` and `getCostRows` both read
-- FROM orders, so a deleted project took its spend out of the dashboard, the CSV
-- and the PDF retroactively. This is the loss 0024 fixed one table over, reached
-- through the foreign key that cascades to `orders` directly rather than through
-- `products`.
--
-- Same remedy, same reason it is retirement and not a refusal: FA-09.5 requires
-- deleting a project to cascade-decommission its infrastructure, and every project
-- that has ever been provisioned has orders — so refusing would make that
-- unreachable in exactly the case it exists for. A project with orders is RETIRED:
-- the row stays as the referent its orders, comments and infrastructure elements
-- need, and disappears from every list and from order creation. An empty project
-- is still deleted outright.
--
-- Nullable, with no backfill: NULL means "in use", which is what every existing
-- project is.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "retired_at" timestamp with time zone;

-- Partial index, as for products in 0024: every project read filters on
-- `retired_at IS NULL` and retired rows are the rare ones, so the index only has
-- to cover the live set.
CREATE INDEX IF NOT EXISTS "projects_live_idx" ON "projects" ("id") WHERE "retired_at" IS NULL;
