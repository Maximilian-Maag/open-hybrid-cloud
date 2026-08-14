-- deployment_environments.callback_secret is the identity of the calling
-- environment on an inbound pipeline callback: the webhook routes look the
-- environment up BY the secret and then scope the event to that environment's
-- orders / infrastructure elements.
--
-- Migration 0004 backfilled the column from webhook_token, and webhook_token is
-- not unique — operators who reused one GitLab trigger token across several
-- environments therefore ended up with several environments sharing a callback
-- secret. In that state a callback can only be attributed to one of them
-- (whichever the query happens to return first), so events for the others were
-- silently mis-scoped and their orders stayed stuck in `provisioning`.
--
-- Rotate every duplicate (keeping the lowest id on the original value) and then
-- enforce uniqueness so the ambiguity cannot come back.
--
-- OPERATOR ACTION: any environment rotated here needs its new callback secret
-- copied into the CI system's webhook configuration (Admin → Environments →
-- reveal callback secret). Its inbound callbacks are rejected until then —
-- which is the intended outcome: before this migration those callbacks were
-- being applied to the WRONG environment.
UPDATE "deployment_environments" AS d
  SET "callback_secret" =
    -- 'ohc-cb-' matches the portal-generated format; two UUIDs give the same
    -- 64 hex chars as generateCallbackSecret() and gen_random_uuid() is
    -- built in (no pgcrypto dependency).
    'ohc-cb-' || replace(gen_random_uuid()::text, '-', '')
              || replace(gen_random_uuid()::text, '-', '')
  WHERE EXISTS (
    SELECT 1 FROM "deployment_environments" AS other
     WHERE other."callback_secret" = d."callback_secret"
       AND other."id" < d."id"
  );
--> statement-breakpoint
ALTER TABLE "deployment_environments"
  ADD CONSTRAINT "deployment_environments_callback_secret_unique" UNIQUE ("callback_secret");
