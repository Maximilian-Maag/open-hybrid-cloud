-- Pipeline stacks used to carry their own webhook_url + webhook_token, but the
-- outbound trigger and the inbound GitLab callback then depended on two
-- separately-maintained tokens (pipeline_stacks vs deployment_environments)
-- that could — and did — silently drift. From now on the deployment
-- environment is the single source of truth: pipeline_stacks.trigger reads
-- webhook_url + webhook_token from its environment.
ALTER TABLE "pipeline_stacks" DROP COLUMN IF EXISTS "webhook_url";
ALTER TABLE "pipeline_stacks" DROP COLUMN IF EXISTS "webhook_token";
