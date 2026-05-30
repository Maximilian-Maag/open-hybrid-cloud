# Handbuch Webshop Admin

## Übersicht

Der Webshop Admin ist verantwortlich für:
- Konfiguration und Pflege des Produktkatalogs
- Systemkonfiguration (GitLab-Anbindung, Umgebungen, Währungen, KI-Anbieter, SMTP)
- Verwaltung lokaler Benutzeraccounts
- Einsicht und Export des Audit-Logs

Der Webshop Admin verwendet einen **lokalen Account** (kein SSO).

---

## 1. Erster Login

1. Browser öffnen und zur Webshop-URL navigieren
2. Auf **Lokaler Login** klicken
3. E-Mail-Adresse und Passwort aus der Serverkonfiguration (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) eingeben
4. Nach dem ersten Login das Passwort unter **Einstellungen → Profil** ändern

---

## 2. Systemkonfiguration

### 2.1 GitLab-Quellen konfigurieren

Unter **Administration → GitLab-Quellen**:

1. **Neue Quelle anlegen** klicken
2. Felder ausfüllen:
   - **Name**: Bezeichnung der GitLab-Instanz (z.B. "GitLab Intern")
   - **URL**: Basis-URL der GitLab-Instanz (z.B. `https://gitlab.example.com`)
   - **Access Token**: Personal Access Token mit `read_api`-Berechtigung
3. **Verbindung testen** — prüft ob die Instanz erreichbar ist
4. Speichern

### 2.2 Deployment-Umgebungen konfigurieren

Unter **Administration → Deployment-Umgebungen**:

1. **Neue Umgebung anlegen** klicken
2. Felder ausfüllen:
   - **Name**: Bezeichnung (z.B. "AWS Frankfurt", "On-Premise Wien")
   - **Beschreibung**: Optional
   - **GitLab-Quelle**: Auswahl aus konfigurierten Quellen
   - **Webhook-URL**: URL des GitLab-Webhooks für diese Umgebung
   - **Webhook-Token**: Sicherheits-Token für den Webhook
3. Speichern

### 2.3 SMTP konfigurieren

Unter **Administration → E-Mail**:

1. SMTP-Serverdaten eintragen (Host, Port, Absenderadresse, Credentials, TLS)
2. **Test-E-Mail senden** klicken — sendet eine Test-E-Mail an die Admin-Adresse
3. Speichern

### 2.4 Leitwährung und Wechselkurse

Unter **Administration → Währungen**:

1. **Leitwährung** auswählen (Standard: EUR) — alle Produktpreise werden in dieser Währung hinterlegt
2. **Wechselkurs-API-Key** und URL hinterlegen
3. **Kurse aktualisieren** klicken — lädt aktuelle Wechselkurse von der konfigurierten API
4. Einzelne Kurse können manuell überschrieben werden

### 2.5 KI-Übersetzung konfigurieren (optional)

Unter **Administration → KI-Übersetzung**:

1. **Anbieter** auswählen: Claude, OpenAI, Azure OpenAI, Ollama, LocalAI
2. **Endpoint-URL** und **API-Key** eintragen (bei Ollama/LocalAI: lokale URL, kein API-Key nötig)
3. **Modell** auswählen oder eintragen
4. **Verbindung testen** klicken
5. Speichern — nach dem Speichern wird die Übersetzungsfunktion in der Produktpflege eingeblendet

---

## 3. Produktkategorien

Unter **Administration → Kategorien**:

- Kategorien anlegen, bearbeiten und löschen
- Jede Kategorie kann ein **Kategorie-Parameterset** erhalten (gilt für alle Produkte dieser Kategorie)
- Reihenfolge der Anzeige im Katalog ist konfigurierbar

---

## 4. Produktkatalog pflegen

### 4.1 Neues Produkt anlegen

Unter **Administration → Produkte → Neu**:

**Schritt 1 – Basisinformationen**
- **Kategorie** wählen
- **Name** und **Beschreibung** in der Basissprache eingeben
- **Bild** hochladen (JPEG/PNG, max. 10 MB)

**Schritt 2 – Übersetzungen**
- Wenn ein KI-Anbieter konfiguriert ist: **KI-Übersetzung erstellen** klicken
- KI übersetzt Name und Beschreibung in alle aktivierten Sprachen
- Einzelne Übersetzungen können manuell bearbeitet werden
- Alle Übersetzungen vor dem Speichern prüfen

**Schritt 3 – Parameter**

*Option A: Import aus `variables.tf`*
1. **Repo browsen** klicken → GitLab-Quelle auswählen
2. Repo und Branch auswählen
3. Eine oder mehrere `variables.tf` Dateien auswählen
4. **Parameter importieren** — Felder werden automatisch aus dem HCL-Parser befüllt
5. Importierte Parameter können angepasst oder ergänzt werden

*Option B: Manuelle Eingabe*
- **Parameter hinzufügen** klicken
- Name, Typ (Text, Zahl, Bool, Dropdown), Beschreibung, Standardwert, Pflichtfeld und Sichtbarkeit je Umgebung festlegen

**Schritt 4 – Deployment-Umgebungen**
- Umgebungen auswählen in denen das Produkt verfügbar sein soll
- Je Umgebung: Webhook-URL (falls abweichend von Umgebungskonfiguration) und umgebungsspezifische Parameter festlegen

**Schritt 5 – Preise**
- Je Umgebung einen Preis in der Leitwährung hinterlegen (z.B. AWS: 70 EUR, On-Prem: 20 EUR)
- Preise sind informativ, keine Zahlungsabwicklung

**Schritt 6 – Kostenstellen-Konfiguration**
Je Umgebung festlegen:
- **Modus**: Projekt / Auswahl / Gemeinkostenstelle
- **Default erzwingen**: Ja → Besteller kann Kostenstelle nicht ändern; Nein → Vorschlag
- Bei Modus "Gemeinkostenstelle": zugehörige Kostenstelle auswählen

### 4.2 Produkt bearbeiten

Unter **Administration → Produkte** das gewünschte Produkt öffnen. Alle Felder aus der Anlage können editiert werden. Übersetzungen können jederzeit per KI neu generiert oder manuell angepasst werden.

### 4.3 Globale Parametersets

Unter **Administration → Globale Parameter**:

Parameter die für *alle* Produkte und *alle* Umgebungen gelten (z.B. Projekt-Tag, Kostenstellen-Label). Diese werden beim Bestellen automatisch zum Formular hinzugefügt.

---

## 5. Kostenstellen verwalten

Unter **Administration → Kostenstellen**:

- Kostenstellen anlegen (Name, Kostenstellennummer, Beschreibung)
- Kostenstellen bearbeiten und deaktivieren (deaktivierte Kostenstellen sind für neue Bestellungen nicht mehr wählbar)
- Diese Liste wird Bestellern bei Modus "Auswahl" angezeigt

---

## 6. Benutzerverwaltung

Unter **Administration → Benutzer**:

- Lokale Benutzeraccounts anlegen (Name, E-Mail, Passwort, Rolle)
- Vorhandene Accounts bearbeiten oder deaktivieren
- SSO-Benutzer (DU Admins, Projektleiter via Entra ID) werden automatisch beim ersten Login angelegt und erscheinen ebenfalls in dieser Liste
- Rollen: **DU Admin**, **Projektleiter**, **Webshop Admin**

---

## 7. Audit-Log

Unter **Administration → Audit-Log**:

- Tabelle aller protokollierten Aktionen mit Zeitstempel, Benutzer, Aktion und Details
- Filterbar nach Zeitraum, Benutzer, Aktionstyp
- **Export als CSV** oder **Export als PDF** — Format vor dem Export wählbar

---

## 8. Infrastrukturübersicht

Unter **Infrastruktur**:

- Vollständige Übersicht aller deployter Infrastrukturelemente, gruppiert nach Projekt und Umgebung
- Als Webshop Admin sind alle Projekte sichtbar (auch fremde)
- Dekommissionierung ist über die Infrastrukturübersicht möglich (Destroy-Webhook)
