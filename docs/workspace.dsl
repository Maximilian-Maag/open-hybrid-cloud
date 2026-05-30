workspace "Infra-Webshop" "Self-Service Portal zum Bestellen, Verwalten und Dekommissionieren von IT Infrastruktur. Go + HTMX, Single Container." {

    model {
        du_admin = person "DU Admin" "Administrator der Digital Unit. Kann alle Bestellungen, Projekte und Infrastruktur einsehen, direkt bestellen und Bestellungen von Projektleitern freigeben oder ablehnen." "Person"
        shop_admin = person "Webshop Admin" "Verwaltet Produktkatalog, Systemkonfiguration und lokale Benutzeraccounts. Sieht alle Projekte und Infrastruktur. Nutzt lokalen Account." "Person"
        project_leader = person "Projektleiter" "Kann Bestellungen aufgeben (Freigabe durch DU Admin erforderlich), eigene Infrastruktur dekommissionieren und Projekte verwalten. Sieht ausschließlich eigene Projekte, Bestellungen und Infrastruktur." "Person"

        gitlab = softwaresystem "GitLab" "Mehrere konfigurierbare GitLab-Instanzen als Quellen für OpenTofu Module. Empfängt Provisioning- und Destroy-Webhooks, führt OpenTofu Workflows aus und stellt API für Repo-Browser und Pipeline-Status bereit." "Existing System"
        oidc_provider = softwaresystem "Microsoft Entra ID" "SSO Identity Provider (OIDC) für die Authentifizierung von DU Admins und Projektleitern." "Existing System"
        ai_translation = softwaresystem "KI-Übersetzungsservice" "Konfigurierbarer KI-Anbieter für die Übersetzung von Produktinhalten in alle EU-Sprachen und Russisch. Cloud: Claude, OpenAI, Azure OpenAI. On-Premise: Ollama, LocalAI. Optional — ohne Konfiguration wird die Funktion ausgeblendet." "Existing System"
        smtp = softwaresystem "Mail Server" "SMTP-Server für transaktionale E-Mails: Bestellbestätigung, Freigabe-Anfrage, Freigabe/Ablehnung, Deployment-Abschluss und Fehlermeldungen." "Existing System"
        exchange_rate_api = softwaresystem "Wechselkurs-API" "Externe API für aktuelle Wechselkurse. Basis für die Umrechnung von der konfigurierten Leitwährung in die Anzeigewährung je Benutzer-Locale." "Existing System"

        webshop = softwaresystem "Infra-Webshop" "Self-Service Portal über das DU Admins und Projektleiter IT Infrastruktur bestellen, verwalten und dekommissionieren können." {

            app = container "Webshop" "Go-Server der HTML-Templates serverseitig rendert und via HTMX als Fragmente ausliefert. Enthält UI, Geschäftslogik, GitLab-Integration und alle Hintergrundprozesse in einem stateless Container." "Go / HTMX / Tailwind / DaisyUI" {

                auth = component "Authentifizierung" "OIDC-Login via Entra ID (Authorization Code Flow) für DU Admins und Projektleiter. Lokale Account-Anmeldung für Webshop Admin. Verwaltet Sessions und Rollen in verschlüsseltem HttpOnly-Cookie."

                catalog = component "Produktkatalog" "Zeigt Infrastruktur-Produkte nach Kategorie mit Bild, mehrsprachiger Beschreibung und Preis. Preisanzeige in der Locale-Währung des Benutzers — Umrechnung aus der Leitwährung anhand gespeicherter Wechselkurse. Beim Bestellen: Auswahl der verfügbaren Deployment-Umgebung, Anzeige der umgebungsspezifischen Parameter."

                order = component "Bestellung" "Bestellformular mit dynamisch generierten Parametern aus globalen, Kategorie- und Produkt-Parametersets sowie umgebungsspezifischen Parametern. Projektzuordnung und Kostenstellen-Zuordnung je Position. DU Admins deployen direkt via Provisioning-Webhook. Projektleiter-Bestellungen warten auf Freigabe."

                approval = component "Freigabe" "Übersicht offener Bestellungen von Projektleitern für DU Admins. Jeder DU Admin kann freigeben oder ablehnen. Ablehnung erfordert Pflichtkommentar. Freigabe löst GitLab Provisioning-Webhook aus."

                infrastructure = component "Infrastrukturübersicht" "Zeigt deployte Infrastrukturelemente gruppiert nach Projekt und Deployment-Umgebung. DU Admin und Webshop Admin sehen alles, Projektleiter nur eigene. Dekommissionierung via GitLab Destroy-Webhook. Bestehendes Projekt als Bestellvorlage nutzbar."

                status = component "Bestellstatus" "Liefert HTMX-Polling-Fragmente für den Live-Status laufender Provisioning- und Dekommissionierungs-Workflows."

                audit = component "Audit-Log" "Unveränderliches Compliance-Protokoll aller Aktionen: Bestellung, Freigabe, Ablehnung mit Kommentar, Deployment, Dekommissionierung. Für DU Admin und Webshop Admin einsehbar und filterbar. Export als CSV oder PDF wählbar."

                notification = component "Benachrichtigung" "Versendet transaktionale E-Mails. Bestelleingang: Bestätigung an Besteller und Freigabe-Anfrage an alle DU Admins (nur Projektleiter). Freigabe oder Ablehnung mit Kommentar: an Besteller. Deployment abgeschlossen: an Besteller. Deployment fehlgeschlagen: an Besteller und alle DU Admins. Dekommissionierung abgeschlossen: an Besteller."

                admin = component "Administration" "Verwaltung von: Produktkategorien, Produkten (Bild, mehrsprachige Inhalte, Parametersets, Preise je Produkt+Umgebung, Kostenstellen-Konfiguration pro Produkt), globalen Parametersets, GitLab-Quellen (URL + Token je Instanz), Deployment-Umgebungen, Kostenstellen-Liste, Leitwährung, KI-Anbieter-Konfiguration, SMTP-Konfiguration und lokale Benutzeraccounts. Browsed Repos auf konfigurierten GitLab-Quellen via GitLab API und importiert variables.tf Dateien für Produktparameter (HCL-Parser). Shop-Design (Logo-Upload als PNG/SVG, Primär-/Akzentfarbe, Shop-Name, Untertitel, Impressumstext — alles in der Datenbank gespeichert, im Prozess gecacht)."

                polling = component "GitLab Polling" "Goroutine-Pool der periodisch die GitLab API nach Pipeline-Status fragt, den Bestell- und Infrastrukturstatus aktualisiert und Benachrichtigungen bei Statusänderungen auslöst. Koordiniert über PostgreSQL-Locks — sicher bei mehreren Container-Replicas. Verfolgt mehrere gleichzeitige GitLab-Pipeline-IDs je Bestellung (JSONB-Array)."
            }

            database = container "Datenbank" "Persistenz aller Webshop-Daten: Produktkategorien, Produkte (Bild als bytea, Webhook-Referenz), Produktübersetzungen (je Sprachcode), Parametersets (global, Kategorie, Produkt, Umgebung), GitLab-Quellen, Deployment-Umgebungen, Preise je Produkt+Umgebung, Kostenstellen, Wechselkurse, Projekte (mit Kostenstelle), Bestellungen (inkl. Freigabe-Workflow und Ablehnungskommentar), Infrastrukturelemente, Pipeline-IDs als JSONB-Array (mehrere parallele Pipelines je Bestellung), Audit-Log, lokale Benutzer, Branding (Logo als BYTEA, Farben, Shop-Name, Impressumstext) und Produkt-Webhooks (mehrere je Produkt+Umgebung, per exec_order gereiht)." "PostgreSQL" "Database"
        }

        # Beziehungen zwischen Personen und Systemen
        du_admin -> webshop "Bestellt IT Infrastruktur direkt, gibt Bestellungen frei, überwacht alle Projekte"
        shop_admin -> webshop "Verwaltet Produktkatalog, Systemkonfiguration und Benutzer"
        project_leader -> webshop "Bestellt und verwaltet eigene IT Infrastruktur"
        webshop -> gitlab "Browsed Repos, löst Webhooks aus, pollt Pipeline-Status" "JSON/HTTPS"
        webshop -> oidc_provider "Authentifiziert DU Admins und Projektleiter" "OIDC/HTTPS"
        webshop -> ai_translation "Übersetzt Produktinhalte (optional, konfigurierbar)" "JSON/HTTPS"
        webshop -> smtp "Sendet transaktionale E-Mails" "SMTP"
        webshop -> exchange_rate_api "Ruft aktuelle Wechselkurse ab" "JSON/HTTPS"

        # Beziehungen zwischen Containern
        du_admin -> app "Nutzt Weboberfläche" "HTTPS"
        shop_admin -> app "Verwaltet Shop" "HTTPS"
        project_leader -> app "Nutzt Weboberfläche" "HTTPS"
        app -> database "Liest und schreibt Daten" "SQL/TCP"
        app -> gitlab "Webhooks auslösen, Repos browsen, Pipeline-Status pollen" "JSON/HTTPS"
        app -> oidc_provider "OIDC Authorization Code Flow" "HTTPS"
        app -> ai_translation "KI-Übersetzung (optional)" "JSON/HTTPS"
        app -> smtp "E-Mail-Versand" "SMTP"
        app -> exchange_rate_api "Wechselkurse abrufen" "JSON/HTTPS"

        # Beziehungen zwischen Komponenten
        du_admin -> auth "Meldet sich per SSO an"
        project_leader -> auth "Meldet sich per SSO an"
        shop_admin -> auth "Meldet sich mit lokalem Account an"
        auth -> oidc_provider "Authorization Code Flow" "OIDC/HTTPS"
        auth -> database "Liest Benutzer und Rollen, schreibt Sessions"

        du_admin -> catalog "Durchsucht Infrastruktur-Produkte"
        project_leader -> catalog "Durchsucht Infrastruktur-Produkte"
        catalog -> database "Liest Produkte, Kategorien, Preise und Wechselkurse"

        du_admin -> order "Bestellt direkt ohne Freigabe"
        project_leader -> order "Bestellt, Bestellung wartet auf Freigabe"
        order -> database "Speichert Bestellung mit Parametern, Projektzuordnung und Kostenstellen"
        order -> gitlab "Löst Provisioning-Webhook aus (Direktbestellung DU Admin)" "JSON/HTTPS"
        order -> notification "Löst Bestelleingangs-Benachrichtigungen aus"
        order -> audit "Protokolliert Bestellvorgang"

        du_admin -> approval "Prüft und entscheidet über offene Bestellungen"
        approval -> database "Liest offene Bestellungen, schreibt Freigabe oder Ablehnung mit Kommentar"
        approval -> gitlab "Löst Provisioning-Webhook nach Freigabe aus" "JSON/HTTPS"
        approval -> notification "Löst Freigabe- oder Ablehnungs-Benachrichtigung aus"
        approval -> audit "Protokolliert Freigabe oder Ablehnung mit Kommentar"

        du_admin -> infrastructure "Sieht alle Projekte und Infrastruktur"
        shop_admin -> infrastructure "Sieht alle Projekte und Infrastruktur"
        project_leader -> infrastructure "Sieht nur eigene Projekte und Infrastruktur"
        infrastructure -> database "Liest Infrastrukturelemente, Projekte und Umgebungen"
        infrastructure -> gitlab "Löst Destroy-Webhook zur Dekommissionierung aus" "JSON/HTTPS"
        infrastructure -> audit "Protokolliert Dekommissionierungsvorgang"

        du_admin -> status "Verfolgt Deployment-Status"
        project_leader -> status "Verfolgt Status eigener Deployments"
        status -> database "Liest Pipeline-Status"

        du_admin -> audit "Einsicht und Export des Audit-Logs"
        shop_admin -> audit "Einsicht und Export des Audit-Logs"
        audit -> database "Liest und schreibt Audit-Einträge"

        notification -> smtp "Sendet E-Mails" "SMTP"
        notification -> database "Liest Empfängeradressen, protokolliert versendete Nachrichten"

        shop_admin -> admin "Verwaltet Katalog, Konfiguration und Benutzer"
        admin -> database "CRUD Produkte, Kategorien, Parameter, Umgebungen, GitLab-Quellen, Kostenstellen, Währungen, Benutzer"
        admin -> gitlab "Browsed Repos und liest variables.tf für Produktparameter" "JSON/HTTPS"
        admin -> ai_translation "Löst optionale KI-Übersetzung aus" "JSON/HTTPS"
        admin -> exchange_rate_api "Aktualisiert gespeicherte Wechselkurse" "JSON/HTTPS"

        polling -> gitlab "Pollt Pipeline-Status aller laufenden Workflows" "JSON/HTTPS"
        polling -> database "Aktualisiert Bestell- und Infrastrukturstatus"
        polling -> notification "Löst Benachrichtigungen bei Statusänderungen aus"
        polling -> audit "Protokolliert Statusübergänge"

        deploymentEnvironment "Docker Host" {
            deploymentNode "Docker Host" "Einzelner Server für lokale Entwicklung und initiales Deployment" "Docker Engine" {
                deploymentNode "nginx" "HTTPS-Terminierung und Reverse Proxy" "Docker Container / Nginx" {
                }
                deploymentNode "webshop" "Go Webshop-Server" "Docker Container" {
                    containerInstance app
                }
                deploymentNode "postgres" "Datenbank" "Docker Container" {
                    containerInstance database
                }
            }
            deploymentNode "Entra ID (extern)" "" "SaaS" {
                softwareSystemInstance oidc_provider
            }
            deploymentNode "GitLab (extern)" "" "On-Premise / SaaS" {
                softwareSystemInstance gitlab
            }
            deploymentNode "Mail Server (extern)" "" "On-Premise / SaaS" {
                softwareSystemInstance smtp
            }
            deploymentNode "Wechselkurs-API (extern)" "" "SaaS" {
                softwareSystemInstance exchange_rate_api
            }
        }

        deploymentEnvironment "Kubernetes" {
            deploymentNode "Kubernetes Cluster" "Produktions-Cluster" "Kubernetes" {
                deploymentNode "infra-webshop" "Applikations-Namespace" "Kubernetes Namespace" {
                    deploymentNode "Ingress + cert-manager" "HTTPS-Terminierung via Let's Encrypt oder internem CA. Routet externen Traffic zum Webshop Service." "Nginx Ingress / cert-manager" {
                    }
                    deploymentNode "webshop Deployment" "Stateless Go Pods, horizontal skalierbar. Polling via PostgreSQL-Locks koordiniert." "Kubernetes Deployment" {
                        containerInstance app
                    }
                    deploymentNode "postgres StatefulSet" "PostgreSQL mit persistentem Volume" "Kubernetes StatefulSet" {
                        containerInstance database
                    }
                }
            }
            deploymentNode "Entra ID (extern)" "" "SaaS" {
                softwareSystemInstance oidc_provider
            }
            deploymentNode "GitLab (extern)" "" "On-Premise / SaaS" {
                softwareSystemInstance gitlab
            }
            deploymentNode "Mail Server (extern)" "" "On-Premise / SaaS" {
                softwareSystemInstance smtp
            }
            deploymentNode "Wechselkurs-API (extern)" "" "SaaS" {
                softwareSystemInstance exchange_rate_api
            }
        }
    }

    views {
        systemcontext webshop "SystemContext" {
            include *
            autoLayout
            description "Systemkontext: Infra-Webshop und alle externen Systeme"
        }

        container webshop "Container" {
            include *
            autoLayout
            description "Container-Diagramm: Go Webshop-Server und PostgreSQL Datenbank"
        }

        component app "Component_App" {
            include *
            autoLayout
            description "Komponentendiagramm Go Webshop-Server"
        }

        deployment webshop "Docker Host" "Deployment_DockerHost" {
            include *
            autoLayout
            description "Deployment auf einem Docker Host mit Nginx für HTTPS"
        }

        deployment webshop "Kubernetes" "Deployment_Kubernetes" {
            include *
            autoLayout
            description "Deployment auf Kubernetes mit Ingress und cert-manager"
        }

        styles {
            element "Person" {
                color #ffffff
                background #08427b
                fontSize 22
                shape Person
            }
            element "Software System" {
                background #1168bd
                color #ffffff
            }
            element "Existing System" {
                background #999999
                color #ffffff
            }
            element "Container" {
                background #438dd5
                color #ffffff
            }
            element "Database" {
                shape Cylinder
            }
            element "Component" {
                background #85bbf0
                color #000000
            }
        }
    }
}
