-- The tables that grow with normal use had no index at all (issue #159).
--
-- Before this the whole schema had four indexes, none of them on a table that
-- grows: `audit_log`, `orders` and `infrastructure_elements` were seq-scanned and
-- re-sorted on every page view. That is invisible on a demo database and it is a
-- multi-second page on a real one — and it gets worse every day the portal is
-- used, which is the part that makes it worth a migration rather than a note.
--
-- Every index below is a composite ending in the column the query ORDERs BY, so
-- the planner gets the filter AND the sort from one index scan. A bare
-- single-column index would still leave Postgres sorting the matched rows.
--
-- Written plain rather than CONCURRENTLY on purpose: drizzle runs a migration
-- file inside one transaction and CREATE INDEX CONCURRENTLY cannot run in one.
-- Each statement therefore takes a brief ACCESS EXCLUSIVE lock on its table. On
-- an installation large enough for that to be a visible outage, build them by
-- hand with CONCURRENTLY first — `IF NOT EXISTS` makes this migration a no-op
-- afterwards.

-- ── audit_log ────────────────────────────────────────────────────────────────
-- The one table guaranteed to grow forever: `lib/audit/index.ts` writes a row for
-- almost every order action and nothing ever deletes one. `listAuditLog` is
-- ORDER BY created_at DESC LIMIT n OFFSET (page-1)*n, plus a COUNT(*) over the
-- same predicate — so without this, page 200 sorted the entire table and threw
-- away 9,950 rows, twice. DESC matches the query's own direction; a btree can be
-- read backwards, but saying it here costs nothing and documents the access
-- pattern.
CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx"
  ON "audit_log" ("created_at" DESC);

-- "everything user N did, newest first" — the user filter and the sort together.
-- A bare (user_id) index, which is what the issue proposed, would have matched
-- the rows and then sorted them anyway.
CREATE INDEX IF NOT EXISTS "audit_log_user_created_at_idx"
  ON "audit_log" ("user_id", "created_at" DESC);

-- ── orders ───────────────────────────────────────────────────────────────────
-- A project manager's order list: WHERE user_id = $1 ORDER BY created_at DESC.
CREATE INDEX IF NOT EXISTS "orders_user_created_at_idx"
  ON "orders" ("user_id", "created_at" DESC);

-- The approval queue is WHERE status = 'pending' ORDER BY created_at ASC, and
-- the dashboard counts the same predicate. Pending is the small minority of a
-- mature `orders` table, so this is the selective end of the index; ASC because
-- that is the order the queue is worked in.
CREATE INDEX IF NOT EXISTS "orders_status_created_at_idx"
  ON "orders" ("status", "created_at");

-- The cost report filters project_id and a created_at range together
-- (`lib/services/costs.ts`). Not in the issue's minimal list, but the issue's own
-- analysis names project_id as unindexed and this is the query that pays for it.
CREATE INDEX IF NOT EXISTS "orders_project_created_at_idx"
  ON "orders" ("project_id", "created_at" DESC);

-- ── infrastructure_elements ──────────────────────────────────────────────────
-- The only index this table had was the PARTIAL one for the decommission sweep
-- (0010), whose comment explains exactly why a bounded scan matters. The same
-- reasoning was never applied to the queries a human triggers.
--
-- Single-column here, deliberately: the infrastructure list lets a caller combine
-- project, product, environment and status filters freely and sort by any of four
-- columns, so no one composite serves it. Separate indexes let the planner
-- bitmap-AND whichever filters were actually supplied.
CREATE INDEX IF NOT EXISTS "infrastructure_elements_project_idx"
  ON "infrastructure_elements" ("project_id");

-- The order detail page's "what did this order provision", and the join in
-- `listInfrastructure`.
CREATE INDEX IF NOT EXISTS "infrastructure_elements_order_idx"
  ON "infrastructure_elements" ("order_id");

-- The deployed-from/deployed-to filter and the default sort.
CREATE INDEX IF NOT EXISTS "infrastructure_elements_deployed_at_idx"
  ON "infrastructure_elements" ("deployed_at" DESC);

-- ── products ─────────────────────────────────────────────────────────────────
-- The catalogue's category filter. `product_translations` and
-- `product_environments` are already covered by their composite primary keys, so
-- the catalogue's correlated subqueries are index lookups — this closes the one
-- part of that query that was not.
--
-- Deliberately NOT addressed here: the catalogue's `ILIKE '%term%'` search over
-- those same correlated subqueries cannot use any index by construction. That
-- needs pg_trgm on a materialised column, or an accepted bound on the scan —
-- a product decision, tracked separately.
CREATE INDEX IF NOT EXISTS "products_category_idx"
  ON "products" ("category_id");
