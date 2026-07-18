# Root Guide

## Overview

The Root account is responsible for:
- Configuring and maintaining the product catalog
- System configuration (GitLab integration, environments, currencies, AI providers, SMTP)
- Managing local user accounts
- Viewing and exporting the audit log

The Root account uses a **local account** (no SSO).

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

> **Persistence:** SMTP settings saved here are stored in the `app_config` database table and override the environment variable defaults at runtime. The configuration persists across container restarts. If the password field is left blank during an update, the existing stored password is preserved.

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

> **Persistence:** AI translation settings saved here are stored in the `app_config` database table and override the environment variable defaults at runtime. The configuration persists across container restarts. If the API key field is left blank during an update, the existing stored key is preserved.

---

## 3. Product Categories

Under **Administration → Categories**:

- Create, edit, and delete categories
- Each category can have a **category parameter set** (applies to all products in that category)
- Display order in the catalog is configurable

> **Important when deleting a category:** The webshop automatically fires the GitLab destroy webhook for every active infrastructure element belonging to any product in the category before the category record is removed. All products and their dependent data within the category are removed via cascading deletes afterward.

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
- **Product Webhooks:** For each selected environment, you can configure multiple webhook endpoints via **Administration → Products → [product] → Webhooks**. Each entry has a name, webhook URL, webhook token, and execution order (`exec_order`). Webhooks with the same `exec_order` fire concurrently; a lower `exec_order` fires before a higher one. If no product webhooks are configured for a given environment, the system falls back to the deployment environment's default webhook URL.

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

### 4.3 Deleting a Product

1. Open the product under **Administration → Products**
2. Click **Delete**
3. Confirm in the dialog

> **Important:** Before the product record is removed, the webshop automatically fires the GitLab destroy webhook for every active infrastructure element that was provisioned from this product. Infrastructure already in status *Decommissioning* or *Decommissioned* is skipped. Dependent database rows (translations, parameters, environment assignments) are removed automatically via cascading deletes.

### 4.4 Global Parameter Sets

Under **Administration → Global Parameters**:

Parameters that apply to *all* products and *all* environments (e.g. project tag, cost center label). These are automatically added to the order form.

### 4.5 Pipeline Stacks

Under **Administration → Products → [product] → Pipeline Stacks**:

Pipeline Stacks let you define an ordered sequence of CI/CD template steps per product+environment directly in the portal — no changes to `.gitlab-ci.yml` required. When an order is approved (or placed directly by an Admin), the portal sends the full step list as `PIPELINE_STACK` JSON to the CI orchestrator pipeline alongside the normal order parameters.

**Creating a pipeline stack:**

1. Open the product under **Administration → Products** and click **Edit**
2. Scroll to the **Pipeline Stacks** card and click **+ Add Stack**
3. Fill in the required fields:
   - **Name**: Label for this stack (e.g. "VM + DNS")
   - **Environment**: Which deployment environment this stack applies to
   - **Webhook URL**: GitLab trigger URL of the *orchestrator* pipeline that reads `PIPELINE_STACK`
   - **Webhook Token**: Pipeline trigger token for the orchestrator project
   - **State Key Parameter**: Name of the order parameter whose value is used as the OpenTofu state key (default: `hostname`). Must be stable across provision and destroy so state can be reused.
4. Click **+ Add Step** one or more times to build the step sequence:
   - **Template**: Path to the step template in the infra-templates repo (e.g. `linode/virtual-machine`)
   - **State Suffix**: Appended to the state key to form the unique state name for this step (e.g. `-vm`)
   - **Upstream Suffix** *(optional)*: State suffix of a preceding step whose outputs this step depends on
   - **Fixed Params** *(optional)*: JSON object of additional CI variables specific to this step
5. Click **Add** — the stack appears in the list

**How it works at runtime:**

When an order is triggered, the portal calls the configured webhook URL with:
- `TEMPLATE=orchestrator`
- `TF_STATE_NAME=<value of the stateKeyParam from the order>`
- `PIPELINE_STACK=<JSON array of steps>`
- All standard order parameters (`ORDER_ID`, `NAME`, etc.)

The orchestrator pipeline reads `PIPELINE_STACK` and dynamically triggers the individual template pipelines in the defined order.

**Managing existing stacks:**

- Each stack is listed with its name, environment, and step count
- Click **Delete** on a stack entry to remove it — active infrastructure is not affected, but future orders for that product+environment will no longer trigger that stack

> **Product Webhooks vs. Pipeline Stacks:** Product Webhooks (section 4.1 "Step 4") call multiple CI endpoints directly and require you to manage trigger tokens and ordering in the portal. Pipeline Stacks call a single orchestrator CI pipeline and let the portal define the execution DAG as data — suitable when all steps share one orchestrator entry point.

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
- SSO users (Admins and project managers via Entra ID, if configured) are created automatically on first login and appear in this list as well
- Roles: **Admin**, **Project Manager**, **Root**

---

## 7. Audit Log

Under **Administration → Audit Log**:

- Table of all logged actions with timestamp, user, action, and details
- Paginated — 50 entries per page
- Filterable by: user, action type, date range (from/to)
- Export as **CSV** or **PDF** — format selectable before export

Logged action types:

| Action | Trigger |
|--------|---------|
| `order.created` | A new order is placed |
| `order.approved` | An Admin approves a pending order |
| `order.rejected` | An Admin rejects a pending order |
| `order.completed` | A CI/CD pipeline completes successfully |
| `order.failed` | A CI/CD pipeline fails |
| `infra.decommissioned` | An infrastructure element is decommissioned |
| `infra.decommission_failed` | A decommission pipeline fails; element reverts to active |
| `config.changed` | A system configuration value is updated |

---

## 8. Infrastructure Overview

Under **Infrastructure**:

- Complete overview of all deployed infrastructure elements, grouped by project and environment
- As Root all projects are visible (including those of other users)
- Decommissioning is available via the infrastructure overview (destroy webhook)

---

## 9. Shop Design

Under **Administration → Shop Design** (or directly at `/admin/branding`):

### 9.1 Colors

- **Primary color**: Used for the header, footer, and navigation bar. Default: `#1e40af` (blue).
- **Secondary color**: Used for buttons and call-to-action elements. Default: `#3b82f6` (sky blue).
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

---

## 10. Settings / Profile

Under **Settings → Profile** (`/settings/profile`):

### 10.1 Password Change

1. Enter your **current password**
2. Enter a **new password** (minimum 8 characters)
3. Confirm the new password — both fields must match
4. Click **Save**

If the current password is incorrect or the confirmation does not match, the change is rejected and an error message is shown.
