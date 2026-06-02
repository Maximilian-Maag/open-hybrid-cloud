.PHONY: help build run migrate css css-watch test vet lint install-requirements docker-build dev dev-down clean docs docs-clean

SERVER   := ./server
MIGRATE  := ./migrate
HANDBOOK := docs/handbook.tex
HANDBOOK_PDF := docs/handbook.pdf

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
	@echo "  lint         golangci-lint ausführen"
	@echo "  docker-build Docker-Image bauen"
	@echo "  dev          Infra-Container starten + Server direkt ausführen (benötigt .env)"
	@echo "  dev-down     Infra-Container stoppen"
	@echo "  docs         Technical Handbook als PDF kompilieren (benötigt pdflatex)"
	@echo "  docs-clean   LaTeX-Hilfsdateien entfernen"
	@echo "  install-requirements  System-Pakete + Go-Tools installieren (Ubuntu/Manjaro)"
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

lint:
	golangci-lint run ./...

install-requirements:
	@echo "==> Detecting package manager..."
	@if command -v pacman >/dev/null 2>&1; then \
		echo "==> Manjaro/Arch — pacman"; \
		sudo pacman -S --needed --noconfirm go nodejs npm docker docker-compose; \
		sudo systemctl enable --now docker; \
		sudo usermod -aG docker $$USER; \
	elif command -v apt-get >/dev/null 2>&1; then \
		echo "==> Ubuntu/Debian — apt-get"; \
		sudo apt-get update -qq; \
		sudo apt-get install -y golang-go nodejs npm docker.io docker-compose-v2; \
		sudo systemctl enable --now docker; \
		sudo usermod -aG docker $$USER; \
	else \
		echo "ERROR: Unsupported OS. Please install Go 1.23+, Node.js 20+, and Docker manually."; \
		exit 1; \
	fi
	@echo "==> Installing Go tools..."
	go install golang.org/x/tools/cmd/goimports@latest
	go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	@echo ""
	@echo "==> Done. If docker was freshly installed, log out and back in for group membership to take effect."

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

docs:
	@command -v pdflatex >/dev/null 2>&1 || \
	  { echo "ERROR: pdflatex not found. Install TeX Live: sudo pacman -S texlive-most"; exit 1; }
	@echo "Compiling handbook (pass 1/2)..."
	cd docs && pdflatex -interaction=nonstopmode handbook.tex > /dev/null
	@echo "Compiling handbook (pass 2/2 — ToC + references)..."
	cd docs && pdflatex -interaction=nonstopmode handbook.tex > /dev/null
	@echo "Done: $(HANDBOOK_PDF)"

docs-clean:
	cd docs && rm -f handbook.aux handbook.log handbook.out handbook.toc \
	               handbook.lof handbook.lot handbook.fls handbook.fdb_latexmk

clean:
	rm -f $(SERVER) $(MIGRATE)
	rm -f ui/static/css/style.css
