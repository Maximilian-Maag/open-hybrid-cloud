-- Databases the application code expects but POSTGRES_DB cannot create, because
-- it only ever creates one.
--
--   open_hybrid_cloud_test  apps/backend/vitest.config.ts points DATABASE_URL here
--   open_hybrid_cloud_e2e   the Playwright stack, when run against this compose file
--
-- Scripts in /docker-entrypoint-initdb.d only run when the data directory is
-- EMPTY. An existing volume never sees this file, which is what `make test-db`
-- is for — it creates the same databases against a running container.
SELECT 'CREATE DATABASE open_hybrid_cloud_test'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'open_hybrid_cloud_test')\gexec

SELECT 'CREATE DATABASE open_hybrid_cloud_e2e'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'open_hybrid_cloud_e2e')\gexec
