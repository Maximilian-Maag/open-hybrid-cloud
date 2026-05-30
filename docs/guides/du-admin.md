# Handbuch DU Admin

## Übersicht

Als DU Admin (Digital Unit Administrator) kannst du:
- Infrastruktur direkt bestellen (ohne Freigabe-Schritt)
- Bestellungen von Projektleitern freigeben oder ablehnen
- Alle Projekte, Bestellungen und Infrastrukturelemente einsehen
- Infrastruktur dekommissionieren
- Das Audit-Log einsehen

---

## 1. Login

1. Browser öffnen und zur Webshop-URL navigieren
2. **Anmelden mit Microsoft** klicken
3. Microsoft Entra ID Login-Dialog — Anmeldedaten des Unternehmensaccounts eingeben
4. Bei erstem Login: Zustimmung zur Applikation bestätigen

---

## 2. Produktkatalog

### 2.1 Produkte durchsuchen

- Produkte sind nach Kategorien gegliedert
- Preise werden in der Anzeigewährung der Browser-Sprache angezeigt
- Detailansicht zeigt: Beschreibung, verfügbare Umgebungen, Preis je Umgebung, Parameter

### 2.2 Bestellung aufgeben

1. Produkt im Katalog auswählen → **Konfigurieren** klicken
2. **Deployment-Umgebung** wählen (z.B. "AWS Frankfurt", "On-Premise Wien")
3. **Projekt** auswählen oder neu anlegen
4. Parameter ausfüllen (Felder sind vorbefüllt wenn Standardwerte definiert sind)
5. **Kostenstelle** je Position zuweisen (je nach Produktkonfiguration: Projekt / Auswahl / Gemeinkostenstelle)
6. Bestellung prüfen → **Jetzt deployen** klicken

Als DU Admin wird der GitLab Webhook **sofort** ausgelöst — kein Freigabe-Schritt.

### 2.3 Vorlage aus bestehendem Projekt verwenden

1. Unter **Infrastruktur** ein bestehendes Projekt öffnen
2. **Als Vorlage verwenden** klicken
3. Das Bestellformular öffnet sich mit vorausgefüllten Parametern
4. Parameter nach Bedarf anpassen und Bestellung aufgeben

---

## 3. Bestellungen freigeben

Eingehende Bestellungen von Projektleitern erscheinen unter **Freigaben**.

### 3.1 Bestellung freigeben

1. Unter **Freigaben → Offen** eine Bestellung öffnen
2. Bestelldetails prüfen: Produkt, Umgebung, Parameter, Projekt, Kostenstelle
3. **Freigeben** klicken
4. Der GitLab Provisioning-Webhook wird sofort ausgelöst
5. Der Projektleiter erhält eine Bestätigungs-E-Mail

### 3.2 Bestellung ablehnen

1. Unter **Freigaben → Offen** eine Bestellung öffnen
2. **Ablehnen** klicken
3. **Ablehnungsgrund** eingeben — Pflichtfeld, wird dem Projektleiter per E-Mail zugestellt
4. Bestätigen

---

## 4. Bestellstatus verfolgen

Unter **Bestellungen**:

- Übersicht aller Bestellungen (eigene und fremde)
- Status je Bestellung: Wartend auf Freigabe / Freigegeben / Provisioning / Abgeschlossen / Fehlgeschlagen / Abgelehnt
- Detailansicht zeigt Live-Status der GitLab Pipeline (wird automatisch aktualisiert)
- Bei Fehler: Pipeline-Log-Link zur GitLab-Instanz

---

## 5. Infrastrukturübersicht

Unter **Infrastruktur**:

- Alle deployte Infrastrukturelemente aller Projekte und Umgebungen
- Gruppierung nach Projekt und Deployment-Umgebung
- Je Element: Produkt, Parameter, Status, Preis, Kostenstelle, Bestelldatum, Besteller

### 5.1 Infrastruktur dekommissionieren

1. Infrastrukturelement in der Übersicht auswählen
2. **Dekommissionieren** klicken
3. Bestätigung im Dialog
4. GitLab Destroy-Webhook wird ausgelöst — OpenTofu zerstört die Infrastruktur
5. Status wird auf **Wird dekommissioniert** gesetzt und via Polling aktualisiert
6. Besteller erhält Benachrichtigung nach Abschluss

---

## 6. Projekte verwalten

Unter **Projekte**:

- Alle Projekte aller Benutzer einsehbar
- Neue Projekte anlegen (Name, Beschreibung, Kostenstelle)
- Bestehende Projekte bearbeiten
- Kostenstelle eines Projekts ändern

---

## 7. Audit-Log

Unter **Audit-Log**:

- Vollständiges Compliance-Protokoll: Bestellungen, Freigaben, Ablehnungen, Deployments, Dekommissionierungen
- Filterbar nach Zeitraum, Benutzer, Aktionstyp, Projekt
- **Export als CSV** oder **Export als PDF** wählbar

---

## 8. E-Mail-Benachrichtigungen

Als DU Admin erhältst du automatisch E-Mails bei:

| Ereignis | Beschreibung |
|----------|-------------|
| Neue Bestellung (Projektleiter) | Freigabe-Anfrage mit Link zur Bestellung |
| Deployment fehlgeschlagen | Fehlerdetails und Link zur Pipeline |
