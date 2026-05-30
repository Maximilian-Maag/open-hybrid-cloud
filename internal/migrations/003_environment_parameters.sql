-- 003_environment_parameters.sql: Add environment_id to parameters for env-specific params

ALTER TABLE parameters ADD COLUMN environment_id BIGINT NOT NULL DEFAULT 0;

CREATE INDEX idx_parameters_scope ON parameters(scope, scope_id, environment_id);
