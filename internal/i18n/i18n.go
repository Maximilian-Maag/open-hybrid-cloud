package i18n

// T returns the translated string for key in lang.
// Fallback chain: lang → en (for non-German) → de → key.
func T(key, lang string) string {
	if lang == "" {
		lang = "de"
	}
	if msgs, ok := messages[key]; ok {
		if v, ok := msgs[lang]; ok && v != "" {
			return v
		}
		if lang != "de" {
			if v, ok := msgs["en"]; ok && v != "" {
				return v
			}
		}
		if v, ok := msgs["de"]; ok && v != "" {
			return v
		}
	}
	return key
}

// Supported returns all supported BCP-47 language codes.
func Supported() []string {
	return []string{
		"de", "en", "fr", "it", "es", "pt", "nl", "pl", "cs", "sk",
		"sl", "hr", "ro", "hu", "bg", "el", "fi", "sv", "da", "et",
		"lv", "lt", "mt", "ga", "ru",
	}
}

// LanguageName returns the native name for a language code.
func LanguageName(code string) string {
	names := map[string]string{
		"de": "Deutsch", "en": "English", "fr": "Français", "it": "Italiano",
		"es": "Español", "pt": "Português", "nl": "Nederlands", "pl": "Polski",
		"cs": "Čeština", "sk": "Slovenčina", "sl": "Slovenščina", "hr": "Hrvatski",
		"ro": "Română", "hu": "Magyar", "bg": "Български", "el": "Ελληνικά",
		"fi": "Suomi", "sv": "Svenska", "da": "Dansk", "et": "Eesti",
		"lv": "Latviešu", "lt": "Lietuvių", "mt": "Malti", "ga": "Gaeilge",
		"ru": "Русский",
	}
	if n, ok := names[code]; ok {
		return n
	}
	return code
}

var messages = map[string]map[string]string{
	// Navigation
	"nav.start": {
		"de": "Start", "en": "Home", "fr": "Accueil", "it": "Inizio", "es": "Inicio",
		"pt": "Início", "nl": "Start", "pl": "Start", "cs": "Start", "sk": "Štart",
		"sl": "Start", "hr": "Start", "ro": "Start", "hu": "Kezdőlap", "bg": "Начало",
		"el": "Αρχή", "fi": "Aloitus", "sv": "Start", "da": "Start", "et": "Start",
		"lv": "Sākums", "lt": "Pradžia", "mt": "Bidu", "ga": "Baile", "ru": "Главная",
	},
	"nav.catalog": {
		"de": "Katalog", "en": "Catalog", "fr": "Catalogue", "it": "Catalogo", "es": "Catálogo",
		"pt": "Catálogo", "nl": "Catalogus", "pl": "Katalog", "cs": "Katalog", "sk": "Katalóg",
		"sl": "Katalog", "hr": "Katalog", "ro": "Catalog", "hu": "Katalógus", "bg": "Каталог",
		"el": "Κατάλογος", "fi": "Luettelo", "sv": "Katalog", "da": "Katalog", "et": "Kataloog",
		"lv": "Katalogs", "lt": "Katalogas", "mt": "Katalgu", "ga": "Catalóg", "ru": "Каталог",
	},
	"nav.orders": {
		"de": "Bestellungen", "en": "Orders", "fr": "Commandes", "it": "Ordini", "es": "Pedidos",
		"pt": "Pedidos", "nl": "Bestellingen", "pl": "Zamówienia", "cs": "Objednávky", "sk": "Objednávky",
		"sl": "Naročila", "hr": "Narudžbe", "ro": "Comenzi", "hu": "Rendelések", "bg": "Поръчки",
		"el": "Παραγγελίες", "fi": "Tilaukset", "sv": "Beställningar", "da": "Ordrer", "et": "Tellimused",
		"lv": "Pasūtījumi", "lt": "Užsakymai", "mt": "Ordnijiet", "ga": "Orduithe", "ru": "Заказы",
	},
	"nav.projects": {
		"de": "Projekte", "en": "Projects", "fr": "Projets", "it": "Progetti", "es": "Proyectos",
		"pt": "Projetos", "nl": "Projecten", "pl": "Projekty", "cs": "Projekty", "sk": "Projekty",
		"sl": "Projekti", "hr": "Projekti", "ro": "Proiecte", "hu": "Projektek", "bg": "Проекти",
		"el": "Έργα", "fi": "Projektit", "sv": "Projekt", "da": "Projekter", "et": "Projektid",
		"lv": "Projekti", "lt": "Projektai", "mt": "Proġetti", "ga": "Tionscadail", "ru": "Проекты",
	},
	"nav.infra": {
		"de": "Infrastruktur", "en": "Infrastructure", "fr": "Infrastructure", "it": "Infrastruttura",
		"es": "Infraestructura", "pt": "Infraestrutura", "nl": "Infrastructuur", "pl": "Infrastruktura",
		"cs": "Infrastruktura", "sk": "Infraštruktúra", "sl": "Infrastruktura", "hr": "Infrastruktura",
		"ro": "Infrastructură", "hu": "Infrastruktúra", "bg": "Инфраструктура", "el": "Υποδομή",
		"fi": "Infrastruktuuri", "sv": "Infrastruktur", "da": "Infrastruktur", "et": "Infrastruktuur",
		"lv": "Infrastruktūra", "lt": "Infrastruktūra", "mt": "Infrastruttura", "ga": "Bonneagar",
		"ru": "Инфраструктура",
	},
	"nav.section.mgmt": {"de": "Administration", "en": "Administration"},
	"nav.approvals":    {"de": "Freigaben", "en": "Approvals"},
	"nav.audit":        {"de": "Audit-Log", "en": "Audit Log"},
	"nav.admin":        {"de": "Admin", "en": "Admin"},
	"nav.logout": {
		"de": "Abmelden", "en": "Log out", "fr": "Déconnexion", "it": "Esci", "es": "Cerrar sesión",
		"pt": "Sair", "nl": "Afmelden", "pl": "Wyloguj", "cs": "Odhlásit", "sk": "Odhlásiť",
		"sl": "Odjava", "hr": "Odjava", "ro": "Deconectare", "hu": "Kijelentkezés", "bg": "Изход",
		"el": "Αποσύνδεση", "fi": "Kirjaudu ulos", "sv": "Logga ut", "da": "Log ud", "et": "Logi välja",
		"lv": "Iziet", "lt": "Atsijungti", "mt": "Oħroġ", "ga": "Sínigh amach", "ru": "Выход",
	},

	// Common
	"common.yes":           {"de": "ja", "en": "yes"},
	"common.no":            {"de": "nein", "en": "no"},
	"common.none":          {"de": "–", "en": "–"},
	"common.cancel":        {"de": "Abbrechen", "en": "Cancel"},
	"common.save":          {"de": "Speichern", "en": "Save"},
	"common.create":        {"de": "Erstellen", "en": "Create"},
	"common.edit":          {"de": "Bearbeiten", "en": "Edit"},
	"common.details":       {"de": "Details", "en": "Details"},
	"common.back":          {"de": "← Zurück", "en": "← Back"},
	"common.name":          {"de": "Name", "en": "Name"},
	"common.description":   {"de": "Beschreibung", "en": "Description"},
	"common.created":       {"de": "Erstellt", "en": "Created"},
	"common.status":        {"de": "Status", "en": "Status"},
	"common.contact_admin": {"de": "Bitte Admin kontaktieren.", "en": "Please contact the admin."},
	"common.required_hint": {"de": "Pflichtfeld", "en": "Required"},

	// Actions
	"action.view_all":         {"de": "Alle anzeigen →", "en": "View all →"},
	"action.manage":           {"de": "Verwalten →", "en": "Manage →"},
	"action.overview":         {"de": "Übersicht →", "en": "Overview →"},
	"action.check_now":        {"de": "Jetzt prüfen →", "en": "Review now →"},
	"action.to_catalog":       {"de": "Zum Katalog", "en": "To catalog"},
	"action.all_products":     {"de": "Alle Produkte", "en": "All products"},
	"action.order":            {"de": "Bestellen", "en": "Order"},
	"action.new_order":        {"de": "+ Neue Bestellung", "en": "+ New Order"},
	"action.new_project":      {"de": "+ Neues Projekt", "en": "+ New Project"},
	"action.approve":          {"de": "Freigeben", "en": "Approve"},
	"action.reject":           {"de": "Ablehnen", "en": "Reject"},
	"action.decomm":           {"de": "Dekommissionieren", "en": "Decommission"},
	"action.submit_order":     {"de": "Bestellen", "en": "Place order"},
	"action.use_as_template":  {"de": "Als Vorlage nutzen", "en": "Use as template"},

	// Price
	"price.from":       {"de": "Preis ab", "en": "Price from"},
	"price.from_short": {"de": "ab", "en": "from"},
	"price.on_request": {"de": "auf Anfrage", "en": "on request"},
	"price.per_month":  {"de": "/Monat", "en": "/month"},
	"price.per_month_s":{"de": "/Mo.", "en": "/mo."},
	"price.vat_note":   {"de": "Preise zzgl. MwSt., monatlich", "en": "Prices excl. VAT, monthly"},

	// Status
	"status.none_open": {"de": "Keine offen", "en": "None open"},
	"status.pending":   {"de": "Offene Freigaben", "en": "Pending approvals"},

	// Home
	"home.subtitle":   {"de": "Infrastruktur Self-Service Portal", "en": "Infrastructure Self-Service Portal"},
	"home.welcome":    {"de": "Willkommen", "en": "Welcome"},
	"home.from_catalog":{"de": "Aus dem Katalog", "en": "From the catalog"},

	// Stats
	"stats.orders":   {"de": "Bestellungen", "en": "Orders"},
	"stats.projects": {"de": "Projekte", "en": "Projects"},
	"stats.infra":    {"de": "Infrastruktur", "en": "Infrastructure"},
	"stats.approvals":{"de": "Freigaben", "en": "Approvals"},

	// Catalog
	"catalog.title":           {"de": "Produktkatalog", "en": "Product Catalog"},
	"catalog.subtitle":        {"de": "Wählen Sie eine Infrastrukturlösung für Ihr Projekt", "en": "Choose an infrastructure solution for your project"},
	"catalog.no_products":     {"de": "Noch keine Produkte verfügbar", "en": "No products available yet"},
	"catalog.no_products_hint":{"de": "Der Webshop Admin muss zuerst Produkte und Kategorien anlegen.", "en": "The webshop admin needs to create products and categories first."},
	"catalog.environments":    {"de": "Umgebung", "en": "environment"},
	"catalog.environments_pl": {"de": "Umgebungen", "en": "environments"},

	// Product detail
	"product.params":      {"de": "Konfigurationsparameter", "en": "Configuration Parameters"},
	"product.params_hint": {"de": "Diese Parameter werden bei der Bestellung ausgefüllt.", "en": "These parameters are filled in when ordering."},
	"product.choose_env":  {"de": "Umgebung wählen", "en": "Choose Environment"},
	"product.env_hint":    {"de": "Wählen Sie die Zielumgebung für die Bereitstellung.", "en": "Select the target environment for deployment."},
	"product.no_envs":     {"de": "Keine Umgebungen konfiguriert.", "en": "No environments configured."},
	"param.name_col":      {"de": "Parameter", "en": "Parameter"},
	"param.type":          {"de": "Typ", "en": "Type"},
	"param.required":      {"de": "Pflicht", "en": "Required"},
	"param.default":       {"de": "Standard", "en": "Default"},

	// Orders
	"orders.title":    {"de": "Bestellungen", "en": "Orders"},
	"orders.empty":    {"de": "Keine Bestellungen vorhanden.", "en": "No orders yet."},
	"order.back":      {"de": "← Zurück zu Bestellungen", "en": "← Back to orders"},
	"order.product":   {"de": "Produkt", "en": "Product"},
	"order.env":       {"de": "Umgebung", "en": "Environment"},
	"order.project":   {"de": "Projekt", "en": "Project"},
	"order.rejection": {"de": "Ablehnungsgrund", "en": "Rejection reason"},
	"order.parameters":{"de": "Parameter", "en": "Parameters"},

	// New order
	"order_new.title":       {"de": "Neue Bestellung", "en": "New Order"},
	"order_new.product_env": {"de": "Produkt & Umgebung", "en": "Product & Environment"},
	"order_new.project":     {"de": "Projekt", "en": "Project"},
	"order_new.choose":      {"de": "— Bitte wählen —", "en": "— Please select —"},
	"order_new.new_project": {"de": "+ Neues Projekt anlegen", "en": "+ Create new project"},
	"order_new.cost_center": {"de": "Kostenstelle", "en": "Cost Center"},
	"order_new.by_project":  {"de": "— Nach Projekt —", "en": "— By project —"},
	"order_new.parameters":  {"de": "Parameter", "en": "Parameters"},
	"order_new.back":        {"de": "← Zurück zum Katalog", "en": "← Back to catalog"},

	// Projects
	"projects.title":     {"de": "Projekte", "en": "Projects"},
	"projects.empty":     {"de": "Noch keine Projekte vorhanden.", "en": "No projects yet."},
	"projects.first":     {"de": "Erstes Projekt anlegen", "en": "Create first project"},
	"project.cost_center":{"de": "Kostenstelle", "en": "Cost Center"},
	"project.none_cc":    {"de": "— Keine —", "en": "— None —"},
	"project.new_title":  {"de": "Neues Projekt", "en": "New Project"},
	"project.edit_title": {"de": "Projekt bearbeiten", "en": "Edit Project"},

	// Infrastructure
	"infra.title":         {"de": "Infrastruktur", "en": "Infrastructure"},
	"infra.subtitle":      {"de": "Alle deployten Infrastrukturelemente", "en": "All deployed infrastructure elements"},
	"infra.empty":         {"de": "Keine Infrastrukturelemente vorhanden.", "en": "No infrastructure elements yet."},
	"infra.deployed":      {"de": "Deployed", "en": "Deployed"},
	"infra.parameters":    {"de": "Parameter", "en": "Parameters"},
	"infra.confirm_decomm":{"de": "Element wirklich dekommissionieren?", "en": "Really decommission this element?"},
	"infra.use_template":  {"de": "Als Vorlage nutzen", "en": "Use as template"},

	// Approvals
	"approvals.title":      {"de": "Offene Freigaben", "en": "Pending Approvals"},
	"approvals.subtitle":   {"de": "Bestellungen von Projektleitern, die auf Freigabe warten", "en": "Orders from project leaders awaiting approval"},
	"approvals.order":      {"de": "Bestellung", "en": "Order"},
	"approvals.reject_note":{"de": "Ablehnungskommentar (Pflicht)", "en": "Rejection comment (required)"},
	"approvals.empty":      {"de": "Keine offenen Freigaben.", "en": "No pending approvals."},

	// Audit
	"audit.title":      {"de": "Audit-Log", "en": "Audit Log"},
	"audit.subtitle":   {"de": "Unveränderliches Compliance-Protokoll", "en": "Immutable compliance log"},
	"audit.timestamp":  {"de": "Zeitstempel", "en": "Timestamp"},
	"audit.action":     {"de": "Aktion", "en": "Action"},
	"audit.entity":     {"de": "Entity", "en": "Entity"},
	"audit.details":    {"de": "Details", "en": "Details"},
	"audit.empty":      {"de": "Keine Einträge vorhanden.", "en": "No entries found."},
	"audit.export_csv": {"de": "CSV exportieren", "en": "Export CSV"},
	"audit.export_pdf": {"de": "PDF exportieren", "en": "Export PDF"},
	"audit.user":       {"de": "Benutzer-ID", "en": "User ID"},

	// Login
	"login.email":    {"de": "E-Mail", "en": "E-Mail"},
	"login.password": {"de": "Passwort", "en": "Password"},
	"login.submit":   {"de": "Anmelden", "en": "Sign in"},
	"login.entra":    {"de": "Mit Entra ID anmelden", "en": "Sign in with Entra ID"},
	"login.or":       {"de": "oder", "en": "or"},

	// Order status labels
	"status.pending_approval":{"de": "Warte auf Freigabe", "en": "Pending Approval"},
	"status.approved":        {"de": "Freigegeben", "en": "Approved"},
	"status.rejected":        {"de": "Abgelehnt", "en": "Rejected"},
	"status.provisioning":    {"de": "In Bereitstellung", "en": "Provisioning"},
	"status.completed":       {"de": "Abgeschlossen", "en": "Completed"},
	"status.failed":          {"de": "Fehlgeschlagen", "en": "Failed"},
	"status.decommissioning": {"de": "Wird dekommissioniert", "en": "Decommissioning"},
	"status.decommissioned":  {"de": "Dekommissioniert", "en": "Decommissioned"},

	// Admin — general
	"admin.back":        {"de": "← Admin", "en": "← Admin"},
	"admin.title":       {"de": "Webshop Admin", "en": "Webshop Admin"},
	"admin.categories":  {"de": "Kategorien", "en": "Categories"},
	"admin.products":    {"de": "Produkte", "en": "Products"},
	"admin.environments":{"de": "Umgebungen", "en": "Environments"},
	"admin.users":       {"de": "Benutzer", "en": "Users"},
	"admin.manage":      {"de": "Verwalten", "en": "Manage"},
	"admin.catalog":     {"de": "Produktkatalog", "en": "Product Catalog"},
	"admin.infra_config":{"de": "Infrastruktur-Konfiguration", "en": "Infrastructure Configuration"},
	"admin.cat_manage":  {"de": "Kategorien verwalten", "en": "Manage categories"},
	"admin.prod_manage": {"de": "Produkte verwalten", "en": "Manage products"},
	"admin.choose":      {"de": "— Bitte wählen —", "en": "— Please select —"},

	// Admin — categories
	"admin.new_category":      {"de": "Neue Kategorie", "en": "New Category"},
	"admin.display_order":     {"de": "Anzeigereihenfolge", "en": "Display Order"},
	"admin.no_categories":     {"de": "Noch keine Kategorien.", "en": "No categories yet."},
	"admin.confirm_delete_cat":{"de": "Kategorie löschen?", "en": "Delete category?"},

	// Admin — environments
	"admin.gitlab_sources":    {"de": "GitLab-Quellen", "en": "GitLab Sources"},
	"admin.deploy_envs":       {"de": "Deployment-Umgebungen", "en": "Deployment Environments"},
	"admin.new_env":           {"de": "Neue Umgebung", "en": "New Environment"},
	"admin.gitlab_source":     {"de": "GitLab-Quelle", "en": "GitLab Source"},
	"admin.webhook_url":       {"de": "Webhook URL", "en": "Webhook URL"},
	"admin.webhook_token":     {"de": "Webhook Token", "en": "Webhook Token"},
	"admin.no_envs":           {"de": "Keine Umgebungen konfiguriert.", "en": "No environments configured."},
	"admin.confirm_delete_env":{"de": "Umgebung löschen?", "en": "Delete environment?"},

	// Admin — sources
	"admin.new_gitlab":        {"de": "Neue GitLab-Quelle", "en": "New GitLab Source"},
	"admin.access_token":      {"de": "Access Token", "en": "Access Token"},
	"admin.no_gitlab":         {"de": "Keine GitLab-Quellen konfiguriert.", "en": "No GitLab sources configured."},
	"admin.confirm_del_gitlab":{"de": "GitLab-Quelle löschen?", "en": "Delete GitLab source?"},

	// Admin — products
	"admin.new_product":      {"de": "Neues Produkt", "en": "New Product"},
	"admin.edit_product":     {"de": "Produkt bearbeiten", "en": "Edit Product"},
	"admin.general":          {"de": "Allgemein", "en": "General"},
	"admin.name_de":          {"de": "Name (Basissprache)", "en": "Name (base language)"},
	"admin.desc_de":          {"de": "Beschreibung (Basissprache)", "en": "Description (base language)"},
	"admin.avail_envs":       {"de": "Verfügbare Umgebungen", "en": "Available Environments"},
	"admin.translations":     {"de": "Übersetzungen", "en": "Translations"},
	"admin.no_products":      {"de": "Noch keine Produkte.", "en": "No products yet."},
	"admin.first_product":    {"de": "Erstes Produkt anlegen", "en": "Create first product"},
	"admin.confirm_del_prod": {"de": "Produkt löschen?", "en": "Delete product?"},
	"admin.product_image":    {"de": "Produktbild", "en": "Product Image"},
	"admin.current_image":    {"de": "Aktuelles Bild", "en": "Current Image"},
	"admin.upload_image":     {"de": "Bild hochladen (JPEG/PNG, max. 10 MB)", "en": "Upload image (JPEG/PNG, max 10 MB)"},

	// Admin — AI translation
	"admin.ai_translation": {"de": "KI-Übersetzung", "en": "AI Translation"},
	"admin.translate_btn":  {"de": "Mit KI übersetzen", "en": "Translate with AI"},
	"admin.translating":    {"de": "Übersetze…", "en": "Translating…"},
	"admin.translate_hint": {"de": "Übersetzt den Inhalt in alle unterstützten Sprachen.", "en": "Translates the content into all supported languages."},

	// Admin — GitLab repo browser
	"admin.browse_repo":   {"de": "Repository durchsuchen", "en": "Browse Repository"},
	"admin.import_vars":   {"de": "variables.tf importieren", "en": "Import variables.tf"},
	"admin.select_source": {"de": "GitLab-Quelle wählen", "en": "Select GitLab source"},
	"admin.select_project":{"de": "Projekt wählen", "en": "Select project"},
	"admin.select_branch": {"de": "Branch wählen", "en": "Select branch"},
	"admin.select_file":   {"de": "Datei wählen", "en": "Select file"},
	"admin.import":        {"de": "Importieren", "en": "Import"},

	// Admin — cost centers
	"admin.cost_centers":  {"de": "Kostenstellen", "en": "Cost Centers"},
	"admin.new_costcenter":{"de": "Neue Kostenstelle", "en": "New Cost Center"},
	"admin.active":        {"de": "Aktiv", "en": "Active"},
	"admin.inactive":      {"de": "Inaktiv", "en": "Inactive"},
	"admin.deactivate":    {"de": "Deaktivieren", "en": "Deactivate"},

	// Admin — parameters
	"admin.parameters": {"de": "Parameter", "en": "Parameters"},

	// Admin — currencies
	"admin.currencies":           {"de": "Währungen & Wechselkurse", "en": "Currencies & Exchange Rates"},
	"admin.currencies_subtitle":  {"de": "Aktuelle Wechselkurse relativ zu EUR", "en": "Current exchange rates relative to EUR"},
	"admin.import_vars_hint":     {"de": "Variablen aus einem Terraform-Repository importieren", "en": "Import variables from a Terraform repository"},
	"admin.base_currency":   {"de": "Leitwährung", "en": "Base Currency"},
	"admin.currency_code":   {"de": "Währungscode", "en": "Currency Code"},
	"admin.rate":            {"de": "Kurs (1 EUR =)", "en": "Rate (1 EUR =)"},
	"admin.rate_updated":    {"de": "Aktualisiert", "en": "Updated"},
	"admin.refresh_rates":   {"de": "Wechselkurse aktualisieren", "en": "Refresh Exchange Rates"},
	"admin.no_rates":        {"de": "Keine Wechselkurse gespeichert.", "en": "No exchange rates stored."},

	// Admin — users
	"admin.new_user":  {"de": "Lokalen Benutzer anlegen", "en": "Create Local User"},
	"admin.user_type": {"de": "Typ", "en": "Type"},
	"admin.sso":       {"de": "SSO", "en": "SSO"},
	"admin.local":     {"de": "Lokal", "en": "Local"},
	"admin.role":      {"de": "Rolle", "en": "Role"},
	"admin.role_admin":{"de": "Webshop Admin", "en": "Webshop Admin"},
	"admin.role_du":   {"de": "Admin", "en": "Admin"},
	"admin.role_pl":   {"de": "Projektleiter", "en": "Project Leader"},
	"admin.password":  {"de": "Passwort", "en": "Password"},

	// Admin — branding
	"admin.branding_title":   {"de": "Shop-Design", "en": "Shop Design"},
	"admin.primary_color":    {"de": "Primärfarbe (Header)", "en": "Primary color (header)"},
	"admin.secondary_color":  {"de": "Akzentfarbe (Buttons)", "en": "Accent color (buttons)"},
	"admin.upload_logo":      {"de": "Logo hochladen (PNG/SVG, max. 200px Höhe)", "en": "Upload logo (PNG/SVG, max 200px height)"},
	"admin.save_branding":    {"de": "Design speichern", "en": "Save design"},
	"admin.preview":          {"de": "Aktuelle Einstellungen", "en": "Current settings"},
	"admin.shop_name":        {"de": "Shop-Name", "en": "Shop name"},
	"admin.shop_subtitle":    {"de": "Untertitel / Claim", "en": "Subtitle / Tagline"},
	"admin.imprint_text":     {"de": "Impressum", "en": "Legal notice / Imprint"},
	"admin.imprint_hint":     {"de": "Wird auf der Impressums-Seite angezeigt.", "en": "Displayed on the imprint page."},
	"nav.impressum":          {"de": "Impressum", "en": "Legal notice"},

	// Search
	"search.placeholder": {"de": "Infrastruktur suchen...", "en": "Search infrastructure..."},

	// Navigation extras
	"nav.hello":     {"de": "Hallo,", "en": "Hello,"},
	"nav.my_orders": {"de": "Meine Bestellungen", "en": "My Orders"},

	// Home hero
	"home.hero_title": {"de": "Infrastruktur für Ihr Team", "en": "Infrastructure for your team"},
	"home.hero_body":  {"de": "Server, VMs, Netzwerk und mehr – direkt aus dem Katalog bestellen.", "en": "Order servers, VMs, networks and more – directly from the catalog."},
	"home.shop_cta":   {"de": "Jetzt stöbern", "en": "Browse now"},

	// Catalog extras
	"catalog.results_for": {"de": "Ergebnisse für", "en": "Results for"},
	"catalog.all_prods":   {"de": "Alle Produkte", "en": "All products"},
	"catalog.categories":  {"de": "Kategorien", "en": "Categories"},
}
