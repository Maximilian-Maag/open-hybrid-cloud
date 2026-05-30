# Anforderungen Infra-Webshop

## 1. Fachliche Anforderungen

### FA-01 Benutzerrollen und Zugriffsrechte

| ID | Anforderung |
|----|-------------|
| FA-01.1 | Das System kennt drei Rollen: **DU Admin**, **Projektleiter** und **Webshop Admin**. |
| FA-01.2 | DU Admins und Projektleiter authentifizieren sich per SSO via Microsoft Entra ID (OIDC). |
| FA-01.3 | Der Webshop Admin verwendet einen lokalen Account. Lokale Accounts können nur vom Webshop Admin angelegt werden. |
| FA-01.4 | DU Admins sehen alle Bestellungen, Projekte und Infrastrukturelemente aller Benutzer. |
| FA-01.5 | Projektleiter sehen ausschließlich eigene Bestellungen, Projekte und Infrastrukturelemente. |
| FA-01.6 | Der Webshop Admin sieht alle Projekte und Infrastrukturelemente, kann jedoch keine Bestellungen aufgeben. |

---

### FA-02 Produktkatalog

| ID | Anforderung |
|----|-------------|
| FA-02.1 | Produkte werden in Kategorien organisiert. Kategorien sind vom Webshop Admin verwaltbar. |
| FA-02.2 | Jedes Produkt hat: Name, Beschreibung, Bild, Kategorie, Parametersets und Preise je Deployment-Umgebung. |
| FA-02.3 | Produktbilder werden in der Datenbank gespeichert (PostgreSQL `bytea`). |
| FA-02.4 | Produktinhalte (Name, Beschreibung) sind mehrsprachig (alle 24 EU-Amtssprachen + Russisch). |
| FA-02.5 | Jedes Produkt kann in einer oder mehreren Deployment-Umgebungen verfügbar sein. |
| FA-02.6 | Preis und Kostenstellen-Konfiguration sind pro Produkt und Umgebung separat festlegbar. |

---

### FA-03 KI-gestützte Übersetzung

| ID | Anforderung |
|----|-------------|
| FA-03.1 | Die Übersetzungsfunktion ist optional. Ohne konfigurierten KI-Anbieter wird sie ausgeblendet. |
| FA-03.2 | Der Webshop Admin wählt im Admin-Panel einen KI-Anbieter und hinterlegt Endpoint, API-Key und Modell. |
| FA-03.3 | Unterstützte Anbieter: Claude (Anthropic), OpenAI, Azure OpenAI (Cloud); Ollama, LocalAI (On-Premise). |
| FA-03.4 | Der Admin erstellt Produktinhalte in einer Basissprache und kann die KI-Übersetzung per Klick auslösen. |
| FA-03.5 | Alle KI-generierten Übersetzungen können vor dem Speichern manuell korrigiert werden. |

---

### FA-04 Produkt-Parameter

| ID | Anforderung |
|----|-------------|
| FA-04.1 | Parameter werden in einer Hierarchie vererbt: Global → Kategorie → Produkt → Umgebung. |
| FA-04.2 | Der Webshop Admin kann beim Erstellen eines Produkts `variables.tf` Dateien aus konfigurierten GitLab-Repos importieren. Parameter werden via HCL-Parser extrahiert (Name, Typ, Beschreibung, Standardwert, Validierung, sensitive Flag). |
| FA-04.3 | Parameter können manuell angelegt, bearbeitet und gelöscht werden. |
| FA-04.4 | Es können globale Parametersets definiert werden, die für alle Produkte und Umgebungen gelten. |
| FA-04.5 | Es können Kategorie-Parametersets definiert werden, die für alle Produkte einer Kategorie gelten. |
| FA-04.6 | Parameter können als umgebungsspezifisch markiert werden (gelten nur für ausgewählte Umgebungen). |

---

### FA-05 Deployment-Umgebungen und GitLab-Quellen

| ID | Anforderung |
|----|-------------|
| FA-05.1 | Mehrere GitLab-Instanzen können als Quellen konfiguriert werden (Name, URL, Access Token). |
| FA-05.2 | Mehrere Deployment-Umgebungen können konfiguriert werden (z.B. "AWS Frankfurt", "On-Premise Wien"). |
| FA-05.3 | Jede Deployment-Umgebung verweist auf eine GitLab-Quelle und ein spezifisches Repo/Webhook. |
| FA-05.4 | Der Webshop Admin kann beim Erstellen eines Produkts Repos auf konfigurierten GitLab-Quellen browsen und `variables.tf` Dateien auswählen. |

---

### FA-06 Bestellprozess

| ID | Anforderung |
|----|-------------|
| FA-06.1 | Bestellungen müssen einem Projekt zugeordnet werden. |
| FA-06.2 | Der Besteller wählt beim Bestellen die Deployment-Umgebung aus. |
| FA-06.3 | Das Bestellformular wird dynamisch aus den geltenden Parametersets generiert. |
| FA-06.4 | Jede Bestellposition muss einer Kostenstelle zugeordnet werden (Modus: Projekt, Auswahl oder Gemeinkostenstelle). |
| FA-06.5 | DU Admins lösen nach dem Checkout direkt den GitLab Provisioning-Webhook aus. |
| FA-06.6 | Bestellungen von Projektleitern warten nach dem Checkout auf Freigabe durch einen DU Admin. |
| FA-06.7 | Ein bestehendes Projekt kann als Vorlage für eine neue Bestellung verwendet werden (Parameter werden vorausgefüllt). |

---

### FA-07 Freigabe-Workflow

| ID | Anforderung |
|----|-------------|
| FA-07.1 | Jeder DU Admin kann offene Bestellungen von Projektleitern freigeben oder ablehnen. |
| FA-07.2 | Bei Ablehnung ist ein Kommentar verpflichtend. |
| FA-07.3 | Freigabe löst den GitLab Provisioning-Webhook mit den Bestellparametern aus. |
| FA-07.4 | Ablehnung mit Kommentar wird dem Projektleiter per E-Mail zugestellt. |

---

### FA-08 Infrastrukturübersicht

| ID | Anforderung |
|----|-------------|
| FA-08.1 | Deployte Infrastrukturelemente werden gruppiert nach Projekt und Deployment-Umgebung angezeigt. |
| FA-08.2 | DU Admin und Webshop Admin sehen alle Projekte. Projektleiter sehen nur eigene. |
| FA-08.3 | Jedes Infrastrukturelement zeigt: Produkt, Umgebung, Bestellparameter, Status, Preis, Kostenstelle. |

---

### FA-09 Dekommissionierung

| ID | Anforderung |
|----|-------------|
| FA-09.1 | Infrastrukturelemente können aus der Infrastrukturübersicht heraus dekommissioniert werden. |
| FA-09.2 | DU Admins können alle Infrastrukturelemente dekommissionieren. Projektleiter nur eigene. |
| FA-09.3 | Dekommissionierung löst den GitLab Destroy-Webhook des zugehörigen OpenTofu-Moduls aus. |
| FA-09.4 | Der Status der Dekommissionierung wird über den GitLab Polling-Mechanismus aktualisiert. |

---

### FA-10 Projekte und Kostenstellen

| ID | Anforderung |
|----|-------------|
| FA-10.1 | Benutzer können Projekte anlegen und verwalten. |
| FA-10.2 | Projektleiter müssen für jedes Projekt eine Kostenstelle hinterlegen können. |
| FA-10.3 | Der Webshop Admin pflegt eine Liste verfügbarer Kostenstellen. |
| FA-10.4 | Der Webshop Admin kann pro Produkt den Kostenstellen-Zuordnungsmodus konfigurieren: **Projekt** (Kostenstelle des Projekts), **Auswahl** (Besteller wählt aus Liste), **Gemeinkostenstelle** (fixer Overhead). |
| FA-10.5 | Der Webshop Admin kann einen Modus als Default setzen und diesen erzwingen oder nur vorschlagen. |

---

### FA-11 Preise und Währungen

| ID | Anforderung |
|----|-------------|
| FA-11.1 | Preise sind rein informativ (keine Zahlungsabwicklung). |
| FA-11.2 | Preise werden pro Produkt und Deployment-Umgebung in der Leitwährung hinterlegt. |
| FA-11.3 | Die Leitwährung ist global konfigurierbar (Standard: EUR). |
| FA-11.4 | Die angezeigte Währung richtet sich nach der Locale des Benutzers (z.B. pl → PLN, cs → CZK). |
| FA-11.5 | Wechselkurse werden über eine externe API abgerufen und in der Datenbank gecacht. |
| FA-11.6 | Der Webshop Admin kann die Wechselkurse manuell aktualisieren. |

---

### FA-12 Lokalisierung

| ID | Anforderung |
|----|-------------|
| FA-12.1 | Die UI ist in allen 24 EU-Amtssprachen und Russisch verfügbar. |
| FA-12.2 | Die Sprachauswahl erfolgt über die Benutzer-Präferenz in der Session, Fallback auf den Accept-Language Header. |
| FA-12.3 | Produktinhalte (Name, Beschreibung) werden sprachspezifisch aus einer Übersetzungstabelle geladen. |

---

### FA-13 Benachrichtigungen

| ID | Ereignis | Empfänger |
|----|----------|-----------|
| FA-13.1 | Bestellung eingegangen (Projektleiter) | Besteller (Bestätigung) + alle DU Admins (Freigabe-Anfrage) |
| FA-13.2 | Bestellung eingegangen (DU Admin) | Besteller (Bestätigung) |
| FA-13.3 | Freigabe erteilt | Besteller |
| FA-13.4 | Ablehnung mit Pflichtkommentar | Besteller |
| FA-13.5 | Deployment abgeschlossen | Besteller |
| FA-13.6 | Deployment fehlgeschlagen | Besteller + alle DU Admins |
| FA-13.7 | Dekommissionierung abgeschlossen | Besteller |

---

### FA-14 Audit-Log

| ID | Anforderung |
|----|-------------|
| FA-14.1 | Alle relevanten Aktionen werden unveränderlich protokolliert: Bestellung, Freigabe, Ablehnung (mit Kommentar), Deployment-Start, Deployment-Abschluss, Deployment-Fehler, Dekommissionierung, Konfigurationsänderungen. |
| FA-14.2 | Das Audit-Log ist für DU Admin und Webshop Admin einsehbar und filterbar. |
| FA-14.3 | Das Audit-Log ist als CSV oder PDF exportierbar. Das Format ist beim Export wählbar. |

---

## 2. Nicht-funktionale Anforderungen

### NFA-01 Deployment und Betrieb

| ID | Anforderung |
|----|-------------|
| NFA-01.1 | Die Applikation wird als einzelner stateless Docker-Container betrieben. |
| NFA-01.2 | **Docker Host:** Nginx-Container (offizielles Image) übernimmt HTTPS-Terminierung und leitet Requests via Reverse Proxy weiter. |
| NFA-01.3 | **Docker Host:** Das Applikations-Image liegt in einem privaten DockerHub Registry. Der Docker-Daemon muss vor dem Start via `docker login` authentifiziert sein. Alle anderen Images (nginx, postgres) sind offizielle Images. |
| NFA-01.4 | **Kubernetes:** Nginx Ingress Controller + cert-manager übernehmen TLS-Terminierung (Let's Encrypt oder internes CA). Das private Image wird über ein `imagePullSecret` im Namespace bezogen. |
| NFA-01.5 | Konfiguration erfolgt ausschließlich über Umgebungsvariablen (12-Factor App). Keine Konfigurationsdateien im Container. |
| NFA-01.6 | Der GitLab-Server ist über eine konfigurierbare URL erreichbar. |
| NFA-01.7 | Die Deployment-Konfiguration für den Docker Host liegt unter `deploy/docker-host/` und enthält: `docker-compose.yml`, `nginx.conf.example` und `.env.example`. |

---

### NFA-02 Skalierbarkeit und Statelessness

| ID | Anforderung |
|----|-------------|
| NFA-02.1 | Der Applikations-Container ist vollständig stateless. Kein lokaler Zustand zwischen Requests. |
| NFA-02.2 | Sessions werden in verschlüsselten HttpOnly-Cookies gespeichert — kein serverseitiger Session-Store benötigt. |
| NFA-02.3 | Der GitLab Polling-Service koordiniert Jobs über PostgreSQL-Locks — sicher bei mehreren Container-Replicas. |
| NFA-02.4 | Horizontale Skalierung (mehrere Replicas) muss ohne Konfigurationsänderung funktionieren. |

---

### NFA-03 Authentifizierung und Sicherheit

| ID | Anforderung |
|----|-------------|
| NFA-03.1 | SSO-Authentifizierung erfolgt über Microsoft Entra ID via OpenID Connect Authorization Code Flow. |
| NFA-03.2 | Lokale Accounts sind ausschließlich für den Webshop Admin vorgesehen. |
| NFA-03.3 | Alle externen Verbindungen (GitLab, Entra ID, SMTP, APIs) erfolgen über HTTPS/TLS. |
| NFA-03.4 | API-Keys und Secrets (GitLab-Tokens, SMTP-Credentials, Session-Secret) werden ausschließlich über Umgebungsvariablen konfiguriert. |

---

### NFA-04 Daten

| ID | Anforderung |
|----|-------------|
| NFA-04.1 | Alle Webshop-Daten werden in PostgreSQL gespeichert. Keine Filesystem-Abhängigkeiten zur Laufzeit. |
| NFA-04.2 | Produktbilder werden als `bytea` in PostgreSQL gespeichert. |
| NFA-04.3 | Das Audit-Log ist unveränderlich (keine UPDATE/DELETE Operationen auf Audit-Einträgen). |
