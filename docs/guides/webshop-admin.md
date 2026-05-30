# Webshop Admin Guide

## Overview

The Webshop Admin is responsible for:
- Configuring and maintaining the product catalog
- System configuration (GitLab integration, environments, currencies, AI providers, SMTP)
- Managing local user accounts
- Viewing and exporting the audit log

The Webshop Admin uses a **local account** (no SSO).

---

## 1. First Login

1. Open your browser and navigate to the webshop URL
2. Click **Local Login**
3. Enter the email address and password from the server configuration (`ADMIN_EMAIL`, `ADMIN_PASSWORD`)
4. After the first login, change the password under **Settings → Profile**

---

## 2. System Configuration

### 2.1 Configuring GitLab Sources

Under **Administration → GitLab Sources**:

1. Click **Add New Source**
2. Fill in the fields:
   - **Name**: Label for the GitLab instance (e.g. "Internal GitLab")
   - **URL**: Base URL of the GitLab instance (e.g. `https://gitlab.example.com`)
   - **Access Token**: Personal access token with `read_api` permission
3. **Test connection** — verifies the instance is reachable
4. Save

### 2.2 Configuring Deployment Environments

Under **Administration → Deployment Environments**:

1. Click **Add New Environment**
2. Fill in the fields:
   - **Name**: Label (e.g. "AWS Frankfurt", "On-Premises Vienna")
   - **Description**: Optional
   - **GitLab Source**: Select from configured sources
   - **Webhook URL**: URL of the GitLab webhook for this environment
   - **Webhook Token**: Security token for the webhook
3. Save

### 2.3 Configuring SMTP

Under **Administration → Email**:

1. Enter SMTP server details (host, port, sender address, credentials, TLS)
2. Click **Send Test Email** — sends a test email to the admin address
3. Save

### 2.4 Base Currency and Exchange Rates

Under **Administration → Currencies**:

1. Select the **base currency** (default: EUR) — all product prices are stored in this currency
2. Enter the **exchange rate API key** and URL
3. Click **Update Rates** — fetches current exchange rates from the configured API
4. Individual rates can be overridden manually

### 2.5 Configuring AI Translation (optional)

Under **Administration → AI Translation**:

1. Select a **provider**: Claude, OpenAI, Azure OpenAI, Ollama, LocalAI
2. Enter the **endpoint URL** and **API key** (for Ollama/LocalAI: local URL, no API key needed)
3. Select or enter a **model**
4. Click **Test Connection**
5. Save — after saving, the translation feature will appear in product editing

---

## 3. Product Categories

Under **Administration → Categories**:

- Create, edit, and delete categories
- Each category can have a **category parameter set** (applies to all products in that category)
- Display order in the catalog is configurable

---

## 4. Managing the Product Catalog

### 4.1 Creating a New Product

Under **Administration → Products → New**:

**Step 1 – Basic Information**
- Select a **category**
- Enter **name** and **description** in the base language
- Upload an **image** (JPEG/PNG, max 10 MB)

**Step 2 – Translations**
- If an AI provider is configured: click **Generate AI Translation**
- AI translates name and description into all enabled languages
- Individual translations can be edited manually
- Review all translations before saving

**Step 3 – Parameters**

*Option A: Import from `variables.tf`*
1. Click **Browse Repo** → select a GitLab source
2. Select repo and branch
3. Select one or more `variables.tf` files
4. Click **Import Parameters** — fields are automatically populated from the HCL parser
5. Imported parameters can be adjusted or supplemented

*Option B: Manual Entry*
- Click **Add Parameter**
- Set name, type (text, number, bool, dropdown), description, default value, required flag, and visibility per environment

**Step 4 – Deployment Environments**
- Select environments in which the product should be available
- Per environment: webhook URL (if different from environment configuration) and environment-specific parameters

**Step 5 – Pricing**
- Enter a price in the base currency per environment (e.g. AWS: 70 EUR, on-premises: 20 EUR)
- Prices are informational; no payment processing

**Step 6 – Cost Center Configuration**
Per environment, set:
- **Mode**: Project / Select / Overhead
- **Force Default**: Yes → orderer cannot change the cost center; No → suggestion only
- For "Overhead" mode: select the associated cost center

### 4.2 Editing a Product

Open the desired product under **Administration → Products**. All fields from creation can be edited. Translations can be regenerated via AI or edited manually at any time.

### 4.3 Global Parameter Sets

Under **Administration → Global Parameters**:

Parameters that apply to *all* products and *all* environments (e.g. project tag, cost center label). These are automatically added to the order form.

---

## 5. Managing Cost Centers

Under **Administration → Cost Centers**:

- Create cost centers (name, cost center code, description)
- Edit and deactivate cost centers (deactivated cost centers are no longer selectable for new orders)
- This list is shown to orderers when the cost center mode is "Select"

---

## 6. User Management

Under **Administration → Users**:

- Create local user accounts (name, email, password, role)
- Edit or deactivate existing accounts
- SSO users (Admins and project leaders via Entra ID) are created automatically on first login and appear in this list as well
- Roles: **Admin**, **Project Leader**, **Webshop Admin**

---

## 7. Audit Log

Under **Administration → Audit Log**:

- Table of all logged actions with timestamp, user, action, and details
- Filterable by time range, user, action type
- Export as **CSV** or **PDF** — format selectable before export

---

## 8. Infrastructure Overview

Under **Infrastructure**:

- Complete overview of all deployed infrastructure elements, grouped by project and environment
- As Webshop Admin all projects are visible (including those of other users)
- Decommissioning is available via the infrastructure overview (destroy webhook)

---

## 9. Shop Design

Under **Administration → Shop Design** (or directly at `/admin/branding`):

### 9.1 Colors

- **Primary color**: Used for the header, footer and navigation bar. Default: `#131921` (dark blue).
- **Accent color**: Used for buttons and call-to-action elements. Default: `#febd69` (amber).
- The live preview on the right updates in real time as you change the color values.

### 9.2 Logo

- Upload a logo image (PNG or SVG recommended, max. 200 px height)
- The logo replaces the shop name text in the header
- Leave empty to display the shop name as plain text

### 9.3 Shop Name and Subtitle

- **Shop name**: Displayed in the header and browser title. Overrides the `APP_NAME` environment variable when set. Leave empty to use the env var.
- **Subtitle / Tagline**: Short description shown in the footer. Overrides `APP_SUBTITLE`.

### 9.4 Imprint (Legal Notice)

- Enter the full imprint text in the **Imprint** field (plain text, line breaks are preserved)
- Once saved, an **Imprint** link appears in the footer
- The imprint is publicly accessible at `/impressum` (no login required)
- Leave empty to hide the imprint link entirely
