-- The fixed shared cost centre for `overhead` mode (FA-10.4).
--
-- cost_center_mode has carried an 'overhead' option since 0000, but there was
-- no column naming WHICH cost centre the overhead account is. Order creation
-- therefore treated 'overhead' exactly like 'select' — it asked the user to
-- pick — which is the opposite of a fixed overhead account.
--
-- Nullable: 'project' and 'select' offerings never use it, and an offering may
-- be switched to 'overhead' before an account has been chosen. ON DELETE SET
-- NULL so deleting a cost centre cannot leave a dangling reference; the order
-- path then reports the missing configuration instead of billing a ghost.
ALTER TABLE "product_environments"
  ADD COLUMN IF NOT EXISTS "overhead_cost_center_id" BIGINT
  REFERENCES "cost_centers"("id") ON DELETE SET NULL;
