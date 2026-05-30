.PHONY: help build run migrate css css-watch test vet docker-build dev dev-down clean

SERVER  := ./server
MIGRATE := ./migrate

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  build        Tailwind-CSS bauen + Go-Binaries kompilieren"
	@echo "  run          Entwicklungsserver starten (benötigt .env)"
	@echo "  migrate      Datenbankmigrationen ausführen"
	@echo "  css          Tailwind-CSS einmalig generieren"
	@echo "  css-watch    Tailwind-CSS im Watch-Modus neu generieren"
	@echo "  test         Tests ausführen"
	@echo "  vet          go vet ausführen"
	@echo "  docker-build Docker-Image bauen"
	@echo "  dev          Infra-Container starten + Server direkt ausführen (benötigt .env)"
	@echo "  dev-down     Infra-Container stoppen"
	@echo "  clean        Build-Artefakte entfernen"

build: node_modules css
	go build -o $(SERVER) ./cmd/server
	go build -o $(MIGRATE) ./cmd/migrate

run:
	go run ./cmd/server

migrate:
	go run ./cmd/migrate

css: node_modules
	npm run build:css

css-watch: node_modules
	npm run watch:css

node_modules:
	npm install

test:
	go test ./...

vet:
	go vet ./...

docker-build:
	docker build -t infra-webshop:latest .

dev: node_modules
	-pkill -INT -f 'cmd/server' 2>/dev/null; true
	npm run build:css
	docker compose up -d
	bash -c 'set -a; source .env; go run ./cmd/server'

dev-down:
	-pkill -INT -f 'cmd/server' 2>/dev/null; true
	docker compose down

clean:
	rm -f $(SERVER) $(MIGRATE)
	rm -f ui/static/css/style.css
