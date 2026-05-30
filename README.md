# Infra-Webshop

Self-Service Portal über das DU Admins und Projektleiter IT Infrastruktur bestellen, verwalten und dekommissionieren können. Der Webshop triggert per Webhook GitLab CI/CD Pipelines, die mittels OpenTofu die gewünschte Infrastruktur deployen.

## Technologie-Stack

| Schicht               | Technologie                              |
|-----------------------|------------------------------------------|
| Server                | Go                                       |
| UI                    | HTMX + Tailwind CSS + DaisyUI            |
| Client-Side-JS        | Alpine.js                                |
| Lokalisierung         | go-i18n (24 EU-Sprachen + Russisch)      |
| KI-Übersetzung        | Adapter (Claude, OpenAI, Ollama, …)      |
| Datenbank             | PostgreSQL                               |
| Authentifizierung     | Microsoft Entra ID (OIDC)                |
| Deployment            | Single Container (scratch-Image)         |
| IaC                   | OpenTofu (via GitLab CI)                 |

## Rollen

| Rolle | Beschreibung |
|-------|--------------|
| **DU Admin** | Kann direkt bestellen, alle Bestellungen freigeben/ablehnen, alle Projekte und Infrastruktur einsehen. SSO via Entra ID. |
| **Projektleiter** | Kann bestellen (Freigabe durch DU Admin erforderlich), eigene Projekte und Infrastruktur verwalten. SSO via Entra ID. |
| **Webshop Admin** | Verwaltet Produktkatalog, Systemkonfiguration und Benutzer. Sieht alle Projekte. Lokaler Account. |

## Bestellprozess

```
Projektleiter:  Bestellt → Wartend auf Freigabe → [Freigegeben] → Provisioning → Abgeschlossen
                                                 ↘ [Abgelehnt + Pflichtkommentar]

DU Admin:       Bestellt → Provisioning → Abgeschlossen
```

## E-Mail-Benachrichtigungen

| Ereignis | Empfänger |
|----------|-----------|
| Bestellung eingegangen (Projektleiter) | Besteller (Bestätigung) + alle DU Admins (Freigabe-Anfrage) |
| Bestellung eingegangen (DU Admin) | Besteller (Bestätigung) |
| Freigabe erteilt | Besteller |
| Ablehnung mit Kommentar | Besteller |
| Deployment abgeschlossen | Besteller |
| Deployment fehlgeschlagen | Besteller + alle DU Admins |
| Dekommissionierung abgeschlossen | Besteller |

## Produkt-Konfiguration

**Parameter-Vererbung:**
```
Globale Parameter          → gelten für alle Produkte, alle Umgebungen
  └── Kategorie-Parameter  → gelten für alle Produkte einer Kategorie
        └── Produkt-Parameter (aus variables.tf + manuell)
              └── Umgebungs-spezifische Parameter
```

**variables.tf Import:** Der Webshop Admin kann Repos auf konfigurierten GitLab-Quellen browsen und `variables.tf` Dateien auswählen. Parameter werden via HCL-Parser (`hashicorp/hcl/v2`) extrahiert (Name, Typ, Beschreibung, Standardwert, Validierung, sensitive Flag).

**Deployment-Umgebungen:** Jede Umgebung (z.B. "AWS Frankfurt", "On-Premise Wien") verweist auf eine konfigurierte GitLab-Quelle. Ein Produkt kann in mehreren Umgebungen verfügbar sein, jeweils mit eigenem Repo/Webhook und Preisen.

## Kostenstellen

Pro Bestellposition wählbar — Konfiguration durch Webshop Admin:

| Modus | Bedeutung |
|-------|-----------|
| **Projekt** | Gebucht auf die Kostenstelle des Projekts (Projektleiter muss Kostenstelle am Projekt hinterlegen) |
| **Auswahl** | Besteller wählt aus einer gepflegten Liste |
| **Gemeinkostenstelle** | Fixer Overhead-Account |

Webshop Admin kann einen Default-Modus setzen und diesen erzwingen oder nur vorschlagen.

## Preise & Währungen

- Preise werden pro Produkt und Umgebung in der Leitwährung hinterlegt (z.B. VM Azure: 70 EUR, VM On-Prem: 20 EUR)
- Leitwährung global konfigurierbar
- Angezeigte Währung folgt der Locale des Benutzers (pl → PLN, cs → CZK, …)
- Wechselkurse via externer API, in DB gecacht

## Lokalisierung

- UI-Texte: `go-i18n` mit JSON-Dateien pro Sprache
- Produktinhalte: `product_translations`-Tabelle (product_id, language_code, name, description)
- Sprachauswahl: User-Präferenz in Session, Fallback auf Accept-Language Header

**KI-Übersetzung (optional):** Webshop Admin konfiguriert einen KI-Anbieter (Endpoint, API-Key, Modell). Bei konfiguriertem Anbieter kann der Admin Produktinhalte per Klick übersetzen lassen und vor dem Speichern manuell korrigieren.

| Anbieter | Typ |
|----------|-----|
| Claude (Anthropic) | Cloud |
| OpenAI / Azure OpenAI | Cloud |
| Ollama | On-Premise |
| LocalAI | On-Premise |

## Audit-Log

Unveränderliches Compliance-Protokoll aller Aktionen. Für DU Admin und Webshop Admin einsehbar. Export als **CSV** oder **PDF** wählbar.

Protokollierte Ereignisse: Bestellung, Freigabe, Ablehnung (mit Kommentar), Deployment, Dekommissionierung, Konfigurationsänderungen.

## Architektur-Entscheidungen

**Go + HTMX** — Serverseitiges Rendering, HTML-Fragmente via HTMX. Kein SPA-Framework, kein Client-Side-State.

**Tailwind CSS + DaisyUI** — Responsives UI. CSS wird im Docker-Build-Stage via Node.js generiert und via `go:embed` eingebettet.

**Single Container** — Go-Binary serviert Templates, statische Assets und API-Logik in einem Container. Stateless, horizontal skalierbar.

**PostgreSQL als Single Source of Truth** — Alle Daten in PostgreSQL: Produktbilder als `bytea`, Audit-Log, Jobs für Polling-Koordination via PostgreSQL-Locks.

**HCL-Parser** — `hashicorp/hcl/v2` parst `variables.tf` Dateien direkt im Backend.

## Projektstruktur

```
infra-webshop/
├── cmd/
│   ├── server/            # HTTP-Server Einstiegspunkt
│   └── migrate/           # Datenbankmigrations-Tool
├── internal/
│   ├── config/            # Konfiguration via Umgebungsvariablen
│   ├── handler/           # HTTP Handler (HTMX Endpoints)
│   ├── service/           # Geschäftslogik-Interfaces
│   ├── repository/        # Datenbankzugriffs-Interfaces
│   ├── model/             # Domain-Typen
│   ├── polling/           # GitLab Polling Worker (Goroutinen)
│   ├── notification/      # E-Mail-Versand
│   └── audit/             # Audit-Log
├── ui/                    # go:embed Root (kein ../-Traversal erlaubt)
│   ├── ui.go              # embed.FS Deklarationen
│   ├── templates/
│   │   ├── layout.html    # DaisyUI Basis-Layout
│   │   ├── pages/         # Vollständige Seiten
│   │   └── partials/      # HTMX HTML-Fragmente
│   └── static/
│       └── css/           # Generiertes Tailwind CSS
├── deploy/
│   └── docker-host/
│       ├── docker-compose.yml   # Produktions-Deployment Docker Host
│       ├── nginx.conf.example   # Nginx Konfigurationsvorlage
│       └── .env.example         # Produktions-Umgebungsvariablen
├── docs/
│   ├── architecture/
│   │   └── workspace.dsl        # Structurizr C4-Architektur
│   ├── requirements/
│   │   └── requirements.md      # Anforderungsdokument
│   └── guides/
│       ├── webshop-admin.md     # Handbuch Webshop Admin
│       └── du-admin.md          # Handbuch DU Admin
├── .env.example                 # Lokale Entwicklung
├── input.css                    # Tailwind-Eingabedatei
├── tailwind.config.js
├── package.json
├── Makefile
├── Dockerfile
└── docker-compose.yml           # Lokale Entwicklungsumgebung
```

## Lokale Entwicklung

### Voraussetzungen

| Tool | Version | Installationshinweis |
|------|---------|----------------------|
| Go | 1.23+ | [go.dev/dl](https://go.dev/dl/) |
| Node.js | 20+ | [nodejs.org](https://nodejs.org/) |
| Docker + Docker Compose | aktuell | [docs.docker.com](https://docs.docker.com/get-docker/) |
| GNU Make | aktuell | Vorinstalliert auf Linux/macOS |

### Make-Targets

```bash
make help         # Alle verfügbaren Targets anzeigen
```

| Target | Beschreibung |
|--------|-------------|
| `make build` | CSS + beide Go-Binaries kompilieren |
| `make run` | Entwicklungsserver starten (`go run`) |
| `make migrate` | Datenbankmigrationen ausführen |
| `make css` | Tailwind-CSS einmalig generieren |
| `make css-watch` | Tailwind-CSS im Watch-Modus (UI-Entwicklung) |
| `make test` | Tests ausführen |
| `make vet` | `go vet` ausführen |
| `make docker-build` | Docker-Image bauen |
| `make dev` | Lokale Services starten (Postgres, Mailpit, Structurizr) |
| `make dev-down` | Lokale Services stoppen |
| `make clean` | Build-Artefakte entfernen |

`npm install` wird automatisch ausgeführt, wenn `node_modules/` fehlt.

### 1. Repository klonen

```bash
git clone <repo-url>
cd infra-webshop
```

### 2. Umgebungsvariablen konfigurieren

```bash
cp .env.example .env
```

Mindestens folgende Werte in `.env` anpassen:

| Variable | Beschreibung |
|----------|-------------|
| `SESSION_SECRET` | Zufälliger String (mind. 32 Zeichen) |
| `ADMIN_PASSWORD` | Initiales Passwort für den Webshop Admin |

Entra ID (`ENTRA_*`) ist für die lokale Entwicklung **optional** — der lokale Admin-Account funktioniert ohne SSO.

### 3. Lokale Services starten

```bash
make dev
```

| Service | URL | Beschreibung |
|---------|-----|-------------|
| PostgreSQL | `localhost:5432` | Datenbank |
| Mailpit Web-UI | [http://localhost:8025](http://localhost:8025) | Alle gesendeten E-Mails lokal einsehen |
| Structurizr Lite | [http://localhost:8088](http://localhost:8088) | C4-Architekturdiagramme |

### 4. Datenbankmigrationen ausführen

```bash
make migrate
```

### 5. CSS generieren

```bash
make css
```

Während der Entwicklung mit Watch-Modus (in separatem Terminal):

```bash
make css-watch
```

### 6. Server starten

```bash
make run
```

Die Applikation ist unter [http://localhost:8080](http://localhost:8080) erreichbar.
Login als Webshop Admin mit den in `.env` gesetzten Credentials.

### Tests ausführen

```bash
make test
```

## Deployment

Beide Umgebungen nutzen dasselbe stateless Container-Image aus dem privaten DockerHub Registry.

### Docker Host

Konfiguration und Dateien unter `deploy/docker-host/`.

**Voraussetzungen auf dem Server:**
- Docker + Docker Compose
- Gültiges TLS-Zertifikat (z.B. Let's Encrypt via certbot)
- Zugriff auf das private DockerHub Registry

**Erstmalige Einrichtung:**

```bash
# 1. Repository auf den Server klonen oder deploy/-Ordner kopieren
cd deploy/docker-host

# 2. Umgebungsvariablen konfigurieren
cp .env.example .env
# .env mit tatsächlichen Werten befüllen

# 3. Nginx-Konfiguration anlegen
cp nginx.conf.example nginx.conf
# server_name und ssl_certificate Pfade in nginx.conf anpassen

# 4. TLS-Zertifikate ablegen
mkdir certs
# fullchain.pem und privkey.pem in ./certs/ kopieren

# 5. DockerHub Login (privates Image)
docker login

# 6. Anwendung starten
docker compose up -d
```

**Image aktualisieren:**

```bash
docker compose pull webshop
docker compose up -d --no-deps webshop
```

### Kubernetes

Nginx Ingress Controller + cert-manager übernehmen TLS-Terminierung. Horizontale Skalierung via Kubernetes Deployment. PostgreSQL als StatefulSet mit persistentem Volume.

Das Container-Image wird aus dem privaten DockerHub Registry gezogen — ein `imagePullSecret` mit DockerHub-Credentials muss im Namespace hinterlegt sein.

## Dokumentation

| Dokument | Pfad |
|----------|------|
| Architektur (C4) | `docs/architecture/workspace.dsl` |
| Anforderungen | `docs/requirements/requirements.md` |
| Handbuch Webshop Admin | `docs/guides/webshop-admin.md` |
| Handbuch DU Admin | `docs/guides/du-admin.md` |
