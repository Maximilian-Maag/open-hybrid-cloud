.PHONY: help install dev dev-down build lint type-check test test-e2e docker-build-backend docker-build-frontend docker-build db-push db-studio docs docs-clean clean

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
	@echo "  build                 build all workspace packages"
	@echo "  lint                  lint all apps"
	@echo "  type-check            TypeScript type-check all apps"
	@echo "  test                  run unit and integration tests"
	@echo "  test-e2e              run end-to-end Playwright tests (requires live stack)"
	@echo "  docker-build-backend  build backend Docker image"
	@echo "  docker-build-frontend build frontend Docker image"
	@echo "  docker-build          build both Docker images"
	@echo "  db-push               push Drizzle schema to the database"
	@echo "  db-studio             open Drizzle Studio"
	@echo "  docs                  compile technical handbook to PDF"
	@echo "  docs-clean            remove LaTeX auxiliary files"
	@echo "  clean                 remove build artifacts"

install:
	$(PNPM) install

dev:
	docker compose -f infra/docker-compose.dev.yml up -d --wait

dev-down:
	docker compose -f infra/docker-compose.dev.yml down

build:
	$(PNPM) build

lint:
	$(PNPM) lint

type-check:
	$(PNPM) --parallel --filter './apps/*' exec tsc --noEmit

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
