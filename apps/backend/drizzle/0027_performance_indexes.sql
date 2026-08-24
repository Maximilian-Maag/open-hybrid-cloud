-- Indexes for the list queries that run on every page view (issue #159).
--
-- Numbered 0027 rather than 0025: dev already carries 0025, and 0026 is taken by
-- a branch in flight.
--
-- Every index below was chosen by reading the `where` and `orderBy` of a query in
-- `lib/services/**` and confirmed with EXPLAIN (ANALYZE, BUFFERS) against 100 000
-- orders, 160 000 infrastructure elements and 1 000 000 audit rows. The measured
-- effect is recorded on each one. Two candidates were tried and dropped because
-- the planner never chose them: `infrastructure_elements (status, …)` — roughly
-- three elements in five are 'active', which is not selective enough to beat a
-- scan — and a plain `products (category_id)`, superseded by the partial
-- composite below.
--
-- The composite shapes are all "equality column first, then the sort columns".
-- That is what lets one index both find the rows and deliver them already
-- ordered, so the LIMIT can stop the scan early instead of sorting the whole
-- match set and throwing most of it away. The `id` tie-break is part of the sort
-- these lists actually use, and OFFSET paging over a sort without one repeats a
-- row on the next page and skips another.
--
-- DESC is written out to match the queries. A btree scans backwards for free, so
-- an ASC index would serve them too; spelling the dominant direction avoids
-- relying on that and documents which query the index is for.

-- audit.ts:120 — ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET n, and
-- audit.ts:176 (the export) reads the same order ascending. The audit log is the
-- one table guaranteed to grow forever and had no index but its primary key, so
-- page 200 sorted a million rows and discarded 9 950 of them: 438 ms -> 24 ms.
CREATE INDEX IF NOT EXISTS "audit_log_created_idx"
  ON "audit_log" ("created_at" DESC, "id" DESC);

-- audit.ts:25 — the same list filtered to one user. Index-only, because the
-- filter and both sort columns are all in the index: 195 ms -> 0.3 ms.
CREATE INDEX IF NOT EXISTS "audit_log_user_created_idx"
  ON "audit_log" ("user_id", "created_at" DESC, "id" DESC);

-- orders.ts:listOrders for an admin — no predicate, ORDER BY created_at DESC,
-- id DESC LIMIT 50. 137 ms -> 1.5 ms.
CREATE INDEX IF NOT EXISTS "orders_created_idx"
  ON "orders" ("created_at" DESC, "id" DESC);

-- orders.ts:listOrders for a project manager, who sees only their own orders.
-- 111 ms -> 1.3 ms.
CREATE INDEX IF NOT EXISTS "orders_user_created_idx"
  ON "orders" ("user_id", "created_at" DESC, "id" DESC);

-- orders.ts:listOrders?projectId (the project detail page) and costs.ts:118-127,
-- which filters project_id together with a created_at range. 72 ms -> 1.3 ms.
CREATE INDEX IF NOT EXISTS "orders_project_created_idx"
  ON "orders" ("project_id", "created_at" DESC, "id" DESC);

-- orders.ts:listOrders?status (the dashboard's pending counter) and
-- approvals.ts:84 (the queue, which reads the same rows ascending). Both become
-- index-only scans — the count never touches the heap at all: 114 ms -> 5.7 ms
-- and 100 ms -> 5.6 ms.
CREATE INDEX IF NOT EXISTS "orders_status_created_idx"
  ON "orders" ("status", "created_at" DESC, "id" DESC);

-- infrastructure.ts:193 — the list's default sort, ORDER BY deployed_at DESC,
-- id DESC LIMIT 50. 161 ms -> 5.9 ms.
CREATE INDEX IF NOT EXISTS "infrastructure_elements_deployed_idx"
  ON "infrastructure_elements" ("deployed_at" DESC, "id" DESC);

-- infrastructure.ts:104 — the projectId filter, and the owner scope that reaches
-- projects through this column. Carries the sort columns so the filtered list is
-- not sorted afterwards: 42 ms -> 0.3 ms.
CREATE INDEX IF NOT EXISTS "infrastructure_elements_project_idx"
  ON "infrastructure_elements" ("project_id", "deployed_at" DESC, "id" DESC);

-- The join in infrastructure.ts:192 and every lookup of an order's elements
-- (infraCostCenters.ts, the retry and teardown paths). order_id is a foreign key
-- with no index, so each of those was a scan of the whole table.
CREATE INDEX IF NOT EXISTS "infrastructure_elements_order_idx"
  ON "infrastructure_elements" ("order_id");

-- catalog.ts:174 — the category filter, which always runs alongside
-- `retired_at IS NULL` and orders by id. Partial and composite so it answers the
-- row query and the COUNT(*) beside it as index-only scans: the count went from
-- reading every product to 4 buffers. Complements products_live_idx (0024),
-- which serves the same query with no category chosen.
CREATE INDEX IF NOT EXISTS "products_category_live_idx"
  ON "products" ("category_id", "id") WHERE "retired_at" IS NULL;
