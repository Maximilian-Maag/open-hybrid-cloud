package i18n

// T returns the translated string for key in lang, falling back to German.
func T(key, lang string) string {
	if lang == "" {
		lang = "de"
	}
	if msgs, ok := messages[key]; ok {
		if v, ok := msgs[lang]; ok && v != "" {
			return v
		}
		if v, ok := msgs["de"]; ok {
			return v
		}
	}
	return key
}

// Supported returns all supported language codes.
func Supported() []string { return []string{"de", "en"} }

var messages = map[string]map[string]string{
	// Navigation
	"nav.start":        {"de": "Start", "en": "Home"},
	"nav.catalog":      {"de": "Katalog", "en": "Catalog"},
	"nav.orders":       {"de": "Bestellungen", "en": "Orders"},
	"nav.projects":     {"de": "Projekte", "en": "Projects"},
	"nav.infra":        {"de": "Infrastruktur", "en": "Infrastructure"},
	"nav.section.mgmt": {"de": "Administration", "en": "Administration"},
	"nav.approvals":    {"de": "Freigaben", "en": "Approvals"},
	"nav.audit":        {"de": "Audit-Log", "en": "Audit Log"},
	"nav.admin":        {"de": "Admin", "en": "Admin"},
	"nav.logout":       {"de": "Abmelden", "en": "Log out"},

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
	"action.view_all":    {"de": "Alle anzeigen →", "en": "View all →"},
	"action.manage":      {"de": "Verwalten →", "en": "Manage →"},
	"action.overview":    {"de": "Übersicht →", "en": "Overview →"},
	"action.check_now":   {"de": "Jetzt prüfen →", "en": "Review now →"},
	"action.to_catalog":  {"de": "Zum Katalog", "en": "To catalog"},
	"action.all_products":{"de": "Alle Produkte", "en": "All products"},
	"action.order":       {"de": "Bestellen", "en": "Order"},
	"action.new_order":   {"de": "+ Neue Bestellung", "en": "+ New Order"},
	"action.new_project": {"de": "+ Neues Projekt", "en": "+ New Project"},
	"action.approve":     {"de": "Freigeben", "en": "Approve"},
	"action.reject":      {"de": "Ablehnen", "en": "Reject"},
	"action.decomm":      {"de": "Dekommissionieren", "en": "Decommission"},
	"action.submit_order":{"de": "Bestellen", "en": "Place order"},

	// Price
	"price.from":       {"de": "Preis ab", "en": "Price from"},
	"price.from_short": {"de": "ab", "en": "from"},
	"price.on_request": {"de": "auf Anfrage", "en": "on request"},
	"price.per_month":  {"de": "/Monat", "en": "/month"},
	"price.per_month_s":{"de": "/Mo.", "en": "/mo."},
	"price.vat_note":   {"de": "Preise zzgl. MwSt., monatlich", "en": "Prices excl. VAT, monthly"},

	// Status
	"status.none_open":    {"de": "Keine offen", "en": "None open"},
	"status.pending":      {"de": "Offene Freigaben", "en": "Pending approvals"},

	// Home
	"home.subtitle":   {"de": "Infrastruktur Self-Service Portal der PORR Digital Unit", "en": "Infrastructure Self-Service Portal of PORR Digital Unit"},
	"home.welcome":    {"de": "Willkommen", "en": "Welcome"},
	"home.from_catalog":{"de": "Aus dem Katalog", "en": "From the catalog"},

	// Stats
	"stats.orders":   {"de": "Bestellungen", "en": "Orders"},
	"stats.projects": {"de": "Projekte", "en": "Projects"},
	"stats.infra":    {"de": "Infrastruktur", "en": "Infrastructure"},
	"stats.approvals":{"de": "Freigaben", "en": "Approvals"},

	// Catalog
	"catalog.title":          {"de": "Produktkatalog", "en": "Product Catalog"},
	"catalog.subtitle":       {"de": "Wählen Sie eine Infrastrukturlösung für Ihr Projekt", "en": "Choose an infrastructure solution for your project"},
	"catalog.no_products":    {"de": "Noch keine Produkte verfügbar", "en": "No products available yet"},
	"catalog.no_products_hint":{"de": "Der Webshop Admin muss zuerst Produkte und Kategorien anlegen.", "en": "The webshop admin needs to create products and categories first."},
	"catalog.environments":   {"de": "Umgebung", "en": "environment"},
	"catalog.environments_pl":{"de": "Umgebungen", "en": "environments"},

	// Product detail
	"product.params":       {"de": "Konfigurationsparameter", "en": "Configuration Parameters"},
	"product.params_hint":  {"de": "Diese Parameter werden bei der Bestellung ausgefüllt.", "en": "These parameters are filled in when ordering."},
	"product.choose_env":   {"de": "Umgebung wählen", "en": "Choose Environment"},
	"product.env_hint":     {"de": "Wählen Sie die Zielumgebung für die Bereitstellung.", "en": "Select the target environment for deployment."},
	"product.no_envs":      {"de": "Keine Umgebungen konfiguriert.", "en": "No environments configured."},
	"param.name_col":       {"de": "Parameter", "en": "Parameter"},
	"param.type":           {"de": "Typ", "en": "Type"},
	"param.required":       {"de": "Pflicht", "en": "Required"},
	"param.default":        {"de": "Standard", "en": "Default"},

	// Orders
	"orders.title":     {"de": "Bestellungen", "en": "Orders"},
	"orders.empty":     {"de": "Keine Bestellungen vorhanden.", "en": "No orders yet."},
	"order.back":       {"de": "← Zurück zu Bestellungen", "en": "← Back to orders"},
	"order.product":    {"de": "Produkt", "en": "Product"},
	"order.env":        {"de": "Umgebung", "en": "Environment"},
	"order.project":    {"de": "Projekt", "en": "Project"},
	"order.rejection":  {"de": "Ablehnungsgrund", "en": "Rejection reason"},
	"order.parameters": {"de": "Parameter", "en": "Parameters"},

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
	"projects.title":    {"de": "Projekte", "en": "Projects"},
	"projects.empty":    {"de": "Noch keine Projekte vorhanden.", "en": "No projects yet."},
	"projects.first":    {"de": "Erstes Projekt anlegen", "en": "Create first project"},
	"project.cost_center":{"de": "Kostenstelle", "en": "Cost Center"},
	"project.none_cc":   {"de": "— Keine —", "en": "— None —"},
	"project.new_title": {"de": "Neues Projekt", "en": "New Project"},
	"project.edit_title":{"de": "Projekt bearbeiten", "en": "Edit Project"},

	// Infrastructure
	"infra.title":       {"de": "Infrastruktur", "en": "Infrastructure"},
	"infra.subtitle":    {"de": "Alle deployten Infrastrukturelemente", "en": "All deployed infrastructure elements"},
	"infra.empty":       {"de": "Keine Infrastrukturelemente vorhanden.", "en": "No infrastructure elements yet."},
	"infra.deployed":    {"de": "Deployed", "en": "Deployed"},
	"infra.parameters":  {"de": "Parameter", "en": "Parameters"},
	"infra.confirm_decomm":{"de": "Element wirklich dekommissionieren?", "en": "Really decommission this element?"},

	// Approvals
	"approvals.title":       {"de": "Offene Freigaben", "en": "Pending Approvals"},
	"approvals.subtitle":    {"de": "Bestellungen von Projektleitern, die auf Freigabe warten", "en": "Orders from project leaders awaiting approval"},
	"approvals.order":       {"de": "Bestellung", "en": "Order"},
	"approvals.reject_note": {"de": "Ablehnungskommentar (Pflicht)", "en": "Rejection comment (required)"},
	"approvals.empty":       {"de": "Keine offenen Freigaben.", "en": "No pending approvals."},

	// Audit
	"audit.title":     {"de": "Audit-Log", "en": "Audit Log"},
	"audit.subtitle":  {"de": "Unveränderliches Compliance-Protokoll", "en": "Immutable compliance log"},
	"audit.timestamp": {"de": "Zeitstempel", "en": "Timestamp"},
	"audit.action":    {"de": "Aktion", "en": "Action"},
	"audit.entity":    {"de": "Entity", "en": "Entity"},
	"audit.details":   {"de": "Details", "en": "Details"},
	"audit.empty":     {"de": "Keine Einträge vorhanden.", "en": "No entries found."},

	// Login
	"login.email":    {"de": "E-Mail", "en": "E-Mail"},
	"login.password": {"de": "Passwort", "en": "Password"},
	"login.submit":   {"de": "Anmelden", "en": "Sign in"},
	"login.entra":    {"de": "Mit Entra ID anmelden", "en": "Sign in with Entra ID"},
	"login.or":       {"de": "oder", "en": "or"},

	// Order status labels
	"status.pending_approval": {"de": "Warte auf Freigabe", "en": "Pending Approval"},
	"status.approved":         {"de": "Freigegeben", "en": "Approved"},
	"status.rejected":         {"de": "Abgelehnt", "en": "Rejected"},
	"status.provisioning":     {"de": "In Bereitstellung", "en": "Provisioning"},
	"status.completed":        {"de": "Abgeschlossen", "en": "Completed"},
	"status.failed":           {"de": "Fehlgeschlagen", "en": "Failed"},
	"status.decommissioning":  {"de": "Wird dekommissioniert", "en": "Decommissioning"},
	"status.decommissioned":   {"de": "Dekommissioniert", "en": "Decommissioned"},

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
	"admin.new_env":            {"de": "Neue Umgebung", "en": "New Environment"},
	"admin.gitlab_source":     {"de": "GitLab-Quelle", "en": "GitLab Source"},
	"admin.webhook_url":       {"de": "Webhook URL", "en": "Webhook URL"},
	"admin.webhook_token":     {"de": "Webhook Token", "en": "Webhook Token"},
	"admin.no_envs":            {"de": "Keine Umgebungen konfiguriert.", "en": "No environments configured."},
	"admin.confirm_delete_env":{"de": "Umgebung löschen?", "en": "Delete environment?"},

	// Admin — sources
	"admin.new_gitlab":        {"de": "Neue GitLab-Quelle", "en": "New GitLab Source"},
	"admin.access_token":      {"de": "Access Token", "en": "Access Token"},
	"admin.no_gitlab":          {"de": "Keine GitLab-Quellen konfiguriert.", "en": "No GitLab sources configured."},
	"admin.confirm_del_gitlab":{"de": "GitLab-Quelle löschen?", "en": "Delete GitLab source?"},

	// Admin — products
	"admin.new_product":        {"de": "Neues Produkt", "en": "New Product"},
	"admin.edit_product":       {"de": "Produkt bearbeiten", "en": "Edit Product"},
	"admin.general":            {"de": "Allgemein", "en": "General"},
	"admin.name_de":            {"de": "Name (Deutsch)", "en": "Name (German)"},
	"admin.desc_de":            {"de": "Beschreibung (Deutsch)", "en": "Description (German)"},
	"admin.avail_envs":         {"de": "Verfügbare Umgebungen", "en": "Available Environments"},
	"admin.translations":       {"de": "Übersetzungen", "en": "Translations"},
	"admin.no_products":        {"de": "Noch keine Produkte.", "en": "No products yet."},
	"admin.first_product":      {"de": "Erstes Produkt anlegen", "en": "Create first product"},
	"admin.confirm_del_prod":   {"de": "Produkt löschen?", "en": "Delete product?"},

	// Admin — cost centers
	"admin.cost_centers":       {"de": "Kostenstellen", "en": "Cost Centers"},
	"admin.new_costcenter":     {"de": "Neue Kostenstelle", "en": "New Cost Center"},
	"admin.active":             {"de": "Aktiv", "en": "Active"},
	"admin.inactive":           {"de": "Inaktiv", "en": "Inactive"},
	"admin.deactivate":         {"de": "Deaktivieren", "en": "Deactivate"},

	// Admin — users
	"admin.new_user":   {"de": "Lokalen Benutzer anlegen", "en": "Create Local User"},
	"admin.user_type":  {"de": "Typ", "en": "Type"},
	"admin.sso":        {"de": "SSO", "en": "SSO"},
	"admin.local":      {"de": "Lokal", "en": "Local"},
	"admin.role":       {"de": "Rolle", "en": "Role"},
	"admin.role_admin": {"de": "Webshop Admin", "en": "Webshop Admin"},
	"admin.role_du":    {"de": "DU Admin", "en": "DU Admin"},
	"admin.role_pl":    {"de": "Projektleiter", "en": "Project Leader"},
	"admin.password":   {"de": "Passwort", "en": "Password"},
}
