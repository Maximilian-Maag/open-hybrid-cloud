.PHONY: help install dev dev-down run run-backend run-frontend build lint type-check test-db test-db-prune test test-e2e docker-build-backend docker-build-frontend docker-build db-push db-studio db-seed db-seed-demo docs docs-clean clean

# pnpm is installed via standalone script — add its bin dir to PATH so make can find it
PNPM_HOME ?= $(HOME)/.local/share/pnpm
export PATH := $(PNPM_HOME)/bin:$(PATH)
PNPM := pnpm

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  install               install all workspace dependencies"
	@echo "  dev                   start infra containers (postgres, mailpit, wiremock, structurizr)"
	@echo "  dev-down              stop infra containers"
	@echo "  run                   start backend and frontend dev servers together (requires: make dev)"
	@echo "  run-backend           start backend dev server on :3001"
	@echo "  run-frontend          start frontend dev server on :3000"
	@echo "  build                 build all workspace packages"
	@echo "  lint                  lint all apps"
	@echo "  type-check            TypeScript type-check all apps"
	@echo "  test-db               create the e2e database in the running Postgres"
	@echo "  test-db-prune         drop the per-directory backend test databases"
	@echo "  test                  run unit and integration tests"
	@echo "  test-e2e              run end-to-end Playwright tests (requires live stack)"
	@echo "  docker-build-backend  build backend Docker image"
	@echo "  docker-build-frontend build frontend Docker image"
	@echo "  docker-build          build both Docker images"
	@echo "  db-push               push Drizzle schema to the database"
	@echo "  db-studio             open Drizzle Studio"
	@echo "  db-seed               seed the database with the initial admin user"
	@echo "  db-seed-demo          add a small demo catalogue (products, orders, infrastructure)"
	@echo "  docs                  compile technical handbook to PDF"
	@echo "  docs-clean            remove LaTeX auxiliary files"
	@echo "  clean                 remove build artifacts"

install:
	$(PNPM) install

dev:
	docker compose -f infra/docker-compose.dev.yml up -d --wait

dev-down:
	docker compose -f infra/docker-compose.dev.yml down

run:
	$(PNPM) --parallel --filter backend --filter frontend dev

run-backend:
	$(PNPM) --filter backend dev

run-frontend:
	$(PNPM) --filter frontend dev

build:
	$(PNPM) build

lint:
	$(PNPM) lint

type-check:
	$(PNPM) --parallel --filter './apps/*' exec tsc --noEmit

# The backend suite creates its own database on first run — one per working
# directory, so a mutation run in .stryker-tmp/sandbox-* cannot truncate the
# tables of an ordinary run (see apps/backend/src/test/database.ts). This target
# is only needed for the e2e database, which the Playwright stack expects to exist.
# Idempotent, so it is safe to re-run.
test-db:
	@for db in open_hybrid_cloud_test open_hybrid_cloud_e2e; do \
	  docker exec ohc-postgres psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$$db'" | grep -q 1 \
	    && echo "  exists  $$db" \
	    || { docker exec ohc-postgres createdb -U postgres "$$db" && echo "  created $$db"; }; \
	done

# Drops the per-directory databases the backend suite created. They are cheap to
# recreate (the schema is pushed on first run) and easy to forget about.
test-db-prune:
	@docker exec ohc-postgres psql -U postgres -tAc \
	  "SELECT datname FROM pg_database WHERE datname LIKE 'open_hybrid_cloud_test\_%'" \
	  | while read -r db; do \
	      [ -n "$$db" ] || continue; \
	      docker exec ohc-postgres dropdb -U postgres --if-exists "$$db" && echo "  dropped $$db"; \
	    done

test:
	$(PNPM) --filter backend test
	$(PNPM) --filter frontend test

test-e2e:
	$(PNPM) test:e2e

docker-build-backend:
	docker build -t open-hybrid-cloud-backend:latest -f apps/backend/Dockerfile .

docker-build-frontend:
	docker build -t open-hybrid-cloud-frontend:latest -f apps/frontend/Dockerfile .

docker-build: docker-build-backend docker-build-frontend

db-push:
	$(PNPM) db:push

db-studio:
	$(PNPM) --filter backend db:studio

db-seed-demo:
	cd apps/backend && ../../node_modules/.bin/tsx --env-file=.env --tsconfig tsconfig.json src/seed-demo.ts

db-seed:
	cd apps/backend && ../../node_modules/.bin/tsx --env-file=.env --tsconfig tsconfig.json src/seed.ts

docs:
	@command -v pdflatex >/dev/null 2>&1 || \
	  { echo "ERROR: pdflatex not found. Install TeX Live: sudo pacman -S texlive-most"; exit 1; }
	@echo "Compiling handbook (pass 1/2)..."
	cd docs && pdflatex -interaction=nonstopmode handbook.tex > /dev/null
	@echo "Compiling handbook (pass 2/2 — ToC + references)..."
	cd docs && pdflatex -interaction=nonstopmode handbook.tex > /dev/null
	@echo "Done: docs/handbook.pdf"

docs-clean:
	cd docs && rm -f handbook.aux handbook.log handbook.out handbook.toc \
	               handbook.lof handbook.lot handbook.fls handbook.fdb_latexmk \
	               handbook.synctex.gz

clean:
	rm -rf apps/backend/.next apps/frontend/.next packages/types/dist
