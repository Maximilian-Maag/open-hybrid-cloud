-- Split the outbound pipeline-trigger token from the inbound webhook-callback
-- secret. Historically deployment_environments.webhook_token served both:
--   * Portal → GitLab   pipeline trigger token (POST body `token`)
--   * GitLab → Portal   X-Gitlab-Token header of the pipeline event webhook
-- The two GitLab UI locations that store them (Settings → CI/CD → Pipeline
-- trigger tokens vs. Settings → Webhooks → Secret token) are independent, so
-- rotating one silently broke the other. Give each role its own column so
-- operators can rotate them independently.
ALTER TABLE "deployment_environments"
  ADD COLUMN IF NOT EXISTS "callback_secret" TEXT;

-- Backfill so existing installations keep working: whatever the operator
-- had set as webhook_token becomes both the trigger token AND the callback
-- secret. New environments get a portal-generated random value.
UPDATE "deployment_environments"
  SET "callback_secret" = "webhook_token"
  WHERE "callback_secret" IS NULL;

ALTER TABLE "deployment_environments"
  ALTER COLUMN "callback_secret" SET NOT NULL;
