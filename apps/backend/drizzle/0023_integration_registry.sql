-- Registry of external systems that are not CI providers (issue #111):
-- Foreman (#112), Ansible/AWX (#113), Nexus and Pulp (#114), Loki (#116) and
-- Grafana (#117).
--
-- BESIDE ci_sources, NOT THROUGH IT. None of the six is a CI provider, so
-- widening ci_sources.provider would leave a column that no longer means
-- anything. Folding ci_sources into this table is a decision that was TAKEN AND
-- DEFERRED rather than overlooked: deployment_environments.ci_source_id
-- references it, the whole lib/ci client layer reads it and the CI-browser
-- endpoints expose it, so the move is a migration with a blast radius and is out
-- of scope here. This table is the substrate that migration would land on.
CREATE TABLE IF NOT EXISTS "integrations" (
  "id"        BIGSERIAL PRIMARY KEY,
  "kind"      TEXT NOT NULL CHECK ("kind" IN ('foreman','ansible','nexus','pulp','loki','grafana')),
  -- Operator-facing label; it shows up in errors, so it should name the instance.
  "name"      TEXT NOT NULL,
  "base_url"  TEXT NOT NULL,
  "auth_type" TEXT NOT NULL DEFAULT 'bearer' CHECK ("auth_type" IN ('none','bearer','basic','token_header')),
  -- Not a secret, and keeping it readable lets the admin UI show WHICH account is
  -- configured without decrypting anything.
  "username"  TEXT NOT NULL DEFAULT '',
  -- AES-256-GCM envelope: 'v1:' || base64(iv[12] || tag[16] || ciphertext).
  -- ci_sources.access_token is plain text; this is the thing #111 exists to not
  -- repeat. Nullable so auth_type='none' stores nothing rather than an empty
  -- ciphertext, and so a row can outlive a revoked credential.
  "credential" TEXT,
  -- NULL = portal-wide. One Loki or Grafana for the installation is normal;
  -- Foreman and Nexus are usually per-environment.
  --
  -- ON DELETE CASCADE, unlike the other references to deployment_environments:
  -- deleteEnvironment() refuses on any non-cascading reference, so a plain FK
  -- here would make an environment undeletable the moment one integration was
  -- bound to it. An integration whose environment is gone has nothing to serve.
  "environment_id" BIGINT REFERENCES "deployment_environments"("id") ON DELETE CASCADE,
  -- Off without losing the URL and the credential. Without it every consumer
  -- would have to treat "absent" and "deliberately disabled" as the same thing,
  -- which is how a blocking integration silently becomes best-effort.
  "enabled"   BOOLEAN NOT NULL DEFAULT TRUE,
  -- Does a failed call block the operation that made it, or is it logged and
  -- carried on from? #111's fifth bullet, answered per integration in the data
  -- model instead of ad hoc at each call site.
  --
  -- DEFAULT 'best_effort' is for rows a migration writes, which cannot know the
  -- intent. The API deliberately does NOT default it — create requires the field,
  -- so nobody gets best-effort by not thinking about it.
  "failure_mode" TEXT NOT NULL DEFAULT 'best_effort' CHECK ("failure_mode" IN ('blocking','best_effort')),
  -- Set on SUCCESS only: "when did this last work" is the operator's question,
  -- and stamping it on a failed attempt would answer a different one.
  "last_contacted_at" TIMESTAMPTZ,
  -- Why the most recent probe failed, cleared on the next success. The pair reads
  -- as "worked at T, broken since".
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Two PARTIAL unique indexes rather than one UNIQUE (kind, environment_id):
-- Postgres treats NULLs as distinct, so the plain constraint would accept five
-- portal-wide Foremans and leave "which Foreman does this environment reconcile
-- against" (#112) with no answer. The trade is that two Nexus instances in one
-- environment are forbidden — accepted, so that resolving a kind for an
-- environment has exactly one answer rather than an arbitrary first row.
CREATE UNIQUE INDEX IF NOT EXISTS "integrations_kind_env_key"
  ON "integrations" ("kind", "environment_id") WHERE "environment_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "integrations_kind_global_key"
  ON "integrations" ("kind") WHERE "environment_id" IS NULL;

-- Every read is a resolve: "the <kind> for this environment, else the global one,
-- if enabled".
CREATE INDEX IF NOT EXISTS "integrations_kind_enabled_idx"
  ON "integrations" ("kind", "enabled");
