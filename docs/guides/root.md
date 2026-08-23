# Root Guide

## Overview

The Root account is responsible for:
- Configuring and maintaining the product catalog
- System configuration (CI sources, environments, exchange rates, AI providers, SMTP)
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

### 2.1 Configuring CI Sources

Under **Administration → CI Sources**:

1. Click **Add CI Source**
2. Fill in the fields:
   - **Name**: Label for the instance (e.g. "Internal GitLab")
   - **URL**: Base URL of the instance (e.g. `https://gitlab.example.com`)
   - **Provider**: **GitLab**, **GitHub**, or **Bitbucket** — determines which API the portal calls to trigger pipelines, browse repositories, and (GitLab only) fetch job traces to parse OpenTofu outputs
   - **Access Token**: A token for that provider with permission to trigger pipelines and read repository contents (GitLab: personal access token with `read_api`; GitHub/Bitbucket: a token with the equivalent repo/workflow scopes)
3. Save

There is no connectivity check on this form — an unreachable URL or bad token only surfaces the first time something actually calls it (browsing repositories when configuring a product, or the first pipeline trigger).

### 2.2 Configuring Deployment Environments

Under **Administration → Deployment Environments**:

1. Click **Add New Environment**
2. Fill in the fields:
   - **Name**: Label (e.g. "AWS Frankfurt", "On-Premises Vienna")
   - **Description**: Optional
   - **CI Source**: Select from the sources configured in 2.1 — any provider
   - **Webhook URL**: URL of the pipeline trigger endpoint for this environment (for a GitLab source: `https://<gitlab>/api/v4/projects/<id>/trigger/pipeline`; see `docs/guides/gitlab-opentofu-workflow.md` for the GitLab setup and the outputs convention it depends on)
   - **Webhook Token**: The **outbound pipeline trigger token** for that provider (for GitLab: `Settings → CI/CD → Pipeline trigger tokens`). Used by the portal to POST the trigger.
3. Save
4. Open the newly-created environment via **Edit** → the **Callback Secret** panel is now populated with a portal-generated random value:
   - Click **Reveal current** → **Copy**
   - In GitLab, go to `<infra-templates project> → Settings → Webhooks → Add new webhook`:
     - URL: `https://<your-portal>/api/webhooks/gitlab/pipeline`
     - Secret token: **paste the callback secret**
     - Trigger: only **Pipeline events**
     - Save
   - Any future pipeline event on that project now reaches the portal (`POST /api/webhooks/gitlab/pipeline`) and updates the associated order/infrastructure status.

   For a GitHub or Bitbucket source, the same callback secret is used, but the portal checks it differently: GitLab compares it directly against the `X-Gitlab-Token` header, while GitHub (`/api/webhooks/github/workflow`) and Bitbucket (`/api/webhooks/bitbucket/pipeline`) instead use it as an HMAC key and verify `X-Hub-Signature-256` / `X-Hub-Signature`. Register the secret as that provider's webhook secret when adding the webhook on the GitHub/Bitbucket side.
5. If you ever need to rotate this secret, use **Regenerate** in the same panel — the new value is displayed once; paste it into the CI provider's webhook configuration to keep the callback flowing.

> **Two separate tokens on the environment:** *Webhook Token* is what the CI provider expects on the outbound pipeline-trigger POST; *Callback Secret* is what the portal expects on the inbound pipeline-event webhook. They are stored in distinct columns and can be rotated independently.

### 2.3 Configuring SMTP

Under **Administration → Email**:

1. Enter SMTP server details: **Host**, **Port** (default `587`), **From Address**, **Username**, **Password**, and **Use TLS** (checkbox)
2. Click **Save Configuration**

There is no "send test email" button — the only way to confirm SMTP works is to trigger a real notification (e.g. place an order) and check whether it arrives.

> **Persistence:** SMTP settings saved here are stored in the `app_config` database table and override the environment variable defaults at runtime. The configuration persists across container restarts. If the password field is left blank during an update, the existing stored password is preserved.

### 2.4 Exchange Rates

Under **Administration → Exchange Rates**:

A read-only table of the currently stored rates (currency, rate to EUR, last updated). Click **Refresh Rates** to re-fetch current rates from the exchange-rate API configured via the `EXCHANGE_RATE_API_URL` environment variable.

The base currency is **fixed to EUR** — every stored rate is "to EUR", and there is no admin control to change it. There is also no way to enter an API key/URL in the UI or to override an individual rate by hand; both of those are configured, if at all, only through `EXCHANGE_RATE_API_URL`.

### 2.5 Configuring AI Translation (optional)

Under **Administration → AI Configuration**:

1. Select a **provider**: Anthropic Claude, OpenAI, Azure OpenAI, Ollama (Local), or LocalAI
2. **API Endpoint** *(optional)* — leave blank to use the default endpoint for the selected provider
3. **API Key** *(required by the hosted providers; not needed for a local Ollama/LocalAI endpoint)* — leave blank on an update to keep the existing key
4. **Model** — required; the field is pre-filled with an example for the selected provider (e.g. `claude-opus-4-5`, `gpt-4o`, `llama3`)
5. Click **Save Configuration**

There is no connection test — an invalid endpoint, key or model only surfaces the next time a translation is actually requested from product editing.

> **Persistence:** AI translation settings saved here are stored in the `app_config` database table and override the environment variable defaults at runtime. The configuration persists across container restarts. If the API key field is left blank during an update, the existing stored key is preserved.

---

## 3. Product Categories

Under **Administration → Categories**:

- Create, edit, and delete categories
- Each category can have a **category parameter set** (applies to all products in that category)
- Display order in the catalog is configurable

> **Important when deleting a category:** The webshop automatically fires the CI destroy trigger(s) for every active infrastructure element belonging to any product in the category before the category record is removed. All products and their dependent data within the category are removed via cascading deletes afterward.

---

## 4. Managing the Product Catalog

### 4.1 Creating a New Product

Under **Administration → Products → New**:

**Step 1 – Basic Information**
- Select a **category**
- Enter **name** and **description** in the base language
- Upload an **image** (PNG, JPEG or WebP, max 10 MB) — optional, and addable later
  on the product's edit page under **Product Image**

  The type is determined from the file's own bytes, not from what the browser
  declares, and SVG is refused: it can carry script and this file is served back to
  every visitor of the product page.

**Step 2 – Translations**
- If an AI provider is configured: click **Generate AI Translation**
- AI translates name and description into all enabled languages
- Individual translations can be edited manually
- Review all translations before saving

**Step 3 – Parameters**

Parameters are configured on the product edit page under the **Parameters** card. There are two ways to populate them:

*Option A: Sync from template (recommended; in practice GitLab only)*
1. First add a **Pipeline Stack** for this product (see section 4.6)
2. Click **Sync from template** — the platform fetches the *first step's* template `variables.tf` from your CI source and creates parameters automatically

   The gate here is the **shape of the environment's webhook URL**, not the CI
   source's provider field: `sync-parameters/route.ts:51` pulls the project id
   out of it with `/\/projects\/(\d+)\//`, then calls `getFileContent` with
   whatever provider the source carries. Only GitLab webhook URLs carry that
   `/projects/<id>/` path, so the feature is GitLab-only in effect — but a
   GitHub or Bitbucket source whose webhook URL happened to match would be let
   through and then fail further in.
3. Each parameter is created with:
   - **Variable Name**: exact Terraform variable name (e.g. `hostname`) — sent to the CI pipeline as `TF_VAR_hostname`
   - **Display Label**: auto-generated human-readable name (e.g. `Hostname`) — shown to users in the order form. Edit this to be more descriptive if needed.
4. Sensitive variables, internal CI variables and names the server owns are automatically excluded — see *Reserved parameter names* below

This only works today when the pipeline stack's environment uses a **GitLab** CI source: the endpoint recovers the GitLab numeric project id from the environment's Webhook URL (`/projects/<id>/trigger/pipeline`) to know where to fetch `variables.tf` from. On a GitHub or Bitbucket environment it fails with "Could not extract project ID…" — use Option B there.

*Option B: Manual entry*
- Click **Add Parameter**
- Set **Variable Name** (must match the Terraform variable name), **Display Label** (user-facing), type (string, number, bool, dropdown), description, default value, and the required/sensitive flags
- Click **Edit** on any existing parameter to modify it

*Reserved parameter names*

A parameter's name becomes a CI trigger variable verbatim, so the names the portal
itself sets are refused (case-insensitively) on both create and edit:
`REF`, `BRANCH`, `WORKFLOW`, `TF_ACTION`, `TF_STATE_NAME`, `TF_STATE_NAMESPACE`,
`TEMPLATE`, `PIPELINE_STACK`, `ORDER_ID`, `ELEMENT_SEQUENCE`, `INFRA_ID`, `TRIAL`
and `TRIAL_DURATION_MINUTES`. A parameter named `REF` would have let anyone who can
order the product choose which git ref the provisioning pipeline runs, and one named
`TF_ACTION` would have turned a provisioning order into a destroy (issue #183).
Values submitted under these names are stripped on their way to the pipeline, so a
definition created before the check existed is inert rather than dangerous.

**Step 4 – Deployment Environments**
- Select environments in which the product should be available
- Per environment: webhook URL (if different from environment configuration) and environment-specific parameters
- **Order Callbacks:** For each selected environment, you can configure optional HTTP callbacks via the **Order Callbacks** card on the product edit page. These notify external systems (e.g. ticketing, monitoring) after an order is processed — they do not trigger provisioning (that is handled by Pipeline Stacks).

**Step 5 – Pricing**
- Enter a price in the base currency per environment (e.g. AWS: 70 EUR, on-premises: 20 EUR)
- Prices are informational; no payment processing

**Step 6 – Cost Center Configuration**
Per environment, set:
- **Cost Center Mode**: **From Project** (the order's project supplies the cost center) / **User Selection** (the orderer picks one from the list) / **Overhead** (every order is billed to one fixed account)
- **Forced CC**: checked → the orderer cannot pick a different cost center (for "User Selection", the picker is still shown but the choice is otherwise just a suggestion when unchecked); for "Overhead", checked makes the **Overhead Cost Center** field mandatory — orders are rejected until one is set
- For "Overhead" mode: select the **Overhead Cost Center** from the list of active cost centers

**Step 7 – Trial (optional)**

Check **Offer as trial** to let orderers provision this offering as a self-expiring trial instead of (or alongside) a normal order:
- **Trial duration (minutes)**: how long after provisioning the infrastructure is automatically decommissioned
- The order form shows a **Try it out** checkbox to the orderer only for environments where this is enabled
- Tearing a trial down on time still needs the [scheduled-decommission sweep](../../README.md#scheduled-decommissioning) configured — the duration is stored as a `scheduledDecommissionAt`, the same field a manual schedule uses, and nothing acts on it without the sweep running
- A trial's pipeline is asked to grant elevated rights inside the provisioned infrastructure — offer this only for templates that actually implement that

### 4.2 Editing a Product

Open the desired product under **Administration → Products**. All fields from creation can be edited. Translations can be regenerated via AI or edited manually at any time.

**Product Image** — the image itself and its description (alt text) are edited separately:
- **Image description**: required before an image can be uploaded, capped at 300 characters, and enforced on both sides — the browser refuses to upload without it, and the server refuses the request too. It is what a screen reader announces instead of the picture, and what displays if the image fails to load. Click **Save description** to update it without touching the file.
- **Image file**: PNG, JPEG or WebP, up to 10 MB. The type is determined from the file's own bytes, not from what the browser declares, and SVG is refused (it can carry script and this file is served back to every visitor of the product page).
- **Remove image** deletes the stored image and its description.

**Version History** — every edit to a product or one of its environment offerings is recorded automatically (no separate save/publish step) as a version, with an auto-generated summary of what changed and an optional free-text changelog. The product edit page shows the full history and lets you pick any two versions to see a field-level diff (added/removed/changed parameters, changed offering fields). An order's own detail page shows the product exactly as it was at order time (a frozen snapshot), not the current live version.

### 4.3 Deleting a Product

1. Open the product under **Administration → Products**
2. Click **Delete**
3. Confirm in the dialog

> **Important:** Before the product record is removed, the webshop automatically fires the CI destroy trigger(s) for every active infrastructure element that was provisioned from this product. Infrastructure already in status *Decommissioning* or *Decommissioned* is skipped. Dependent database rows (translations, parameters, environment assignments) are removed automatically via cascading deletes.

### 4.4 Global Parameter Sets

Under **Administration → Global Parameters**:

Parameters that apply to *all* products and *all* environments (e.g. project tag, cost center label). These are automatically added to the order form.

### 4.5 Available Templates

What to enter as **Template** when configuring a product or a pipeline-stack step.
The full parameter tables are in `docs/guides/gitlab-opentofu-workflow.md`
(“Template Catalogue”) and in the `infra-templates` README; **Sync from template**
reads the same `variables.tf`, so you rarely need to type parameters by hand.

| Provider | Template | Provisions |
|---|---|---|
| Linode | `linode/virtual-machine` | Instance with its own firewall |
| Linode | `linode/firewall` | Standalone firewall |
| Linode | `linode/dns-record` | DNS record |
| Linode | `linode/block-storage` | Volume, optionally attached to an instance |
| Linode | `linode/kubernetes-cluster` | LKE cluster |
| Linode | `linode/load-balancer` | NodeBalancer in front of given backends |
| Linode | `linode/object-storage` | S3-compatible bucket |
| AWS | `aws/network` | VPC with one public subnet per availability zone |
| AWS | `aws/virtual-machine` | EC2 instance with its own security group |
| AWS | `aws/object-storage` | S3 bucket |
| AWS | `aws/database-postgres` | RDS Postgres |
| vSphere | `vsphere/virtual-machine` | VM cloned from a template, Linux or Windows |

Two things to know before offering these:

- **AWS products need a network first.** `aws/virtual-machine` and
  `aws/database-postgres` take a `vpc_id` and subnet ids that come from an
  `aws/network` order. Either order the network once and configure its ids as fixed
  parameters, or — better — build a **pipeline stack** with the network as the first
  step and reference its state from the later ones (section 4.6).
- **Credentials are per provider and live in GitLab**, not in the portal: Linode and
  vSphere as `TF_VAR_*` variables, AWS as its own `AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY`. A product whose provider has no credentials configured
  fails in the apply job, not at order time.

For a Windows VM in vSphere, set the product parameter `guest_os_family` to
`windows`. Leaving it at `linux` clones the template but leaves the guest
unconfigured — no hostname, no address, no domain membership.

---

### 4.6 Pipeline Stacks

Under **Administration → Products → [product] → Pipeline Stacks**:

Pipeline Stacks let you define an ordered sequence of CI/CD template steps per product+environment directly in the portal — no changes to `.gitlab-ci.yml` required. When an order is approved (or placed directly by an Admin), the portal sends the full step list as `PIPELINE_STACK` JSON to the CI orchestrator pipeline alongside the normal order parameters.

**Creating a pipeline stack:**

1. Open the product under **Administration → Products** and click **Edit**
2. Scroll to the **Pipeline Stacks** card and click **+ Add Stack**
3. Fill in the required fields:
   - **Name**: Label for this stack (e.g. "VM + DNS")
   - **Environment**: Which deployment environment this stack applies to. The stack inherits the environment's **Webhook URL** and **Webhook Token** for outbound pipeline triggers — manage them once under **Admin → Environments**, not per stack.
   - **State Key Parameter**: Name of the order parameter whose value forms the readable half of the OpenTofu state key (default: `hostname`). The portal appends the order id to it, so two orders that submit the same value no longer share a state file, and stores the result on the infrastructure element so destroy targets what apply created.
4. Click **+ Add Step** one or more times to build the step sequence:
   - **Template**: Path to the step template in the infra-templates repo (e.g. `linode/virtual-machine`)
   - **State Suffix**: Appended to the state key to form the unique state name for this step (e.g. `-vm`)
   - **Exec Order** *(default `0`)*: Non-negative integer. Steps with the same value run in parallel (single GitLab stage); groups with a higher value wait for all lower groups to finish. On destroy the group order is reversed automatically.
   - **Upstream State Refs** *(optional, one or more)*: Each entry maps a CI variable name (UPPER_SNAKE_CASE, e.g. `VM_STATE_NAME`) to the `stateSuffix` of an earlier step. At runtime the orchestrator sets that variable to the state name of the referenced step, and the base pipeline promotes it to `TF_VAR_<lowercase>` — so a Terraform template can read cross-step outputs via `terraform_remote_state`.
   - **Fixed Params** *(optional)*: Additional CI variables specific to this step, one `KEY=value` per line
5. *(Optional)* Click **Preview YAML** to inspect the generated GitLab pipeline before saving.
6. Click **Add** — the stack appears in the list

**How it works at runtime:**

When an order is triggered, the portal calls the configured webhook URL with:
- `TEMPLATE=orchestrator`
- `TF_STATE_NAME=<stateKeyParam value>-<order id>`
- `PIPELINE_STACK=<JSON array of steps>`
- All standard order parameters (`ORDER_ID`, `NAME`, etc.)

The orchestrator pipeline reads `PIPELINE_STACK` and dynamically triggers the individual template pipelines in the defined order.

**Managing existing stacks:**

- Each stack is listed with its name, environment, and step count
- Click **Edit** on a stack to update its name, state key parameter, or steps. The environment cannot be changed after creation. Trigger URL and token are managed on the environment itself — rotate them in one place and every stack picks up the new value automatically.
- Click **Delete** on a stack entry to remove it — active infrastructure is not affected, but future orders for that product+environment will no longer trigger that stack

> **Order Callbacks vs. Pipeline Stacks:** Order Callbacks (section 4.1 "Step 4") notify external HTTP endpoints after order processing and are optional. Pipeline Stacks call a single orchestrator CI pipeline and let the portal define the execution DAG as data — suitable when all steps share one orchestrator entry point.

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

Logged action types (this list has grown since the feature was first documented — check `logAudit(` call sites — they live under `apps/backend/src/lib/services/`, `apps/backend/src/lib/webhook/` and `apps/backend/src/app/api/audit/export/`):

| Action | Trigger |
|--------|---------|
| `order.created` | A new order is placed |
| `order.provisioning` | An Admin/Root places an order directly (no approval step) |
| `order.approved` | An Admin approves a pending order |
| `order.rejected` | An Admin rejects a pending order |
| `order.completed` | A CI/CD pipeline completes successfully |
| `order.failed` | A CI/CD pipeline fails |
| `order.comment_added` / `order.comment_internal_added` | A comment is added to an order (the internal variant logs when it is marked internal) |
| `order.comment_edited` / `order.comment_deleted` | A comment's author edits or deletes it |
| `cart.checked_out` | A cart checkout completes (whether or not every item succeeded) |
| `infra.decommissioning` | A decommission (immediate or scheduled) starts tearing an element down |
| `infra.decommissioned` | An infrastructure element finishes decommissioning |
| `infra.decommission_failed` | A decommission pipeline fails; element reverts to active |
| `infra.decommission_partial` | A multi-trigger decommission only started tearing down some of its triggers |
| `infra.decommission_scheduled` / `infra.decommission_schedule_cleared` | A future decommission time is set or cleared on an element |
| `infra.retried` / `infra.retry_failed` | A failed deployment's triggers are retried, and whether that retry itself succeeded to start |
| `product.version_recorded` | A product or one of its offerings is edited, recording a new version |

---

## 8. Infrastructure Overview

Under **Infrastructure**:

- Complete overview of all deployed infrastructure elements, grouped by project and environment
- As Root all projects are visible (including those of other users)
- Decommissioning (immediate or scheduled), reordering and retrying a failed deployment all work the same way as for an Admin — see `docs/guides/admin.md` section 5 for the full detail-page walkthrough (Outputs/Parameters/Pipelines cards, action buttons)

---

## 9. Shop Design

Under **Administration → Shop Design** (or directly at `/admin/branding`):

### 9.1 Colors

- **Primary color**: Used for the header, footer, and navigation bar. Default: `#131921` (dark navy).
- **Secondary color**: Used for buttons and call-to-action elements. Default: `#febd69` (amber). The text and border painted on it are derived, not fixed — `layout.tsx` sets `--bs-ink` from `readableInk(secondaryColor)` and `--bs-edge` from `readableAccent(secondaryColor, undefined, AA_NON_TEXT)` — so a light secondary stays AA-clean rather than needing to be replaced.
- The live preview on the right updates in real time as you change the color values.

### 9.2 Logo

- Upload a logo image — any image type the browser will pick (`accept="image/*"`); there is no format allowlist, size limit, or dimension check on either side, unlike the product image upload
- The header renders it at a fixed small size (32px tall, capped at 120px wide, scaled to fit) regardless of the uploaded image's actual dimensions, so an oversized file just costs load time, not layout
- The logo replaces the shop name text in the header
- Leave empty to display the shop name as plain text

### 9.3 Shop Name and Subtitle

- **Shop name**: Displayed in the header and browser title. Defaults to "Open Hybrid Cloud" — there is no `APP_NAME` environment variable; the name lives only in this database-backed setting.
- **Subtitle / Tagline**: Short description shown in the footer. Defaults to empty — likewise, there is no `APP_SUBTITLE` environment variable.

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

### 10.2 Two-Factor Authentication

The Root account holds a local password and the highest privilege level in the
system, so it can be protected with a second factor: a six-digit code from an
authenticator app (Google Authenticator, Authy, Bitwarden, 1Password — anything
that supports standard TOTP). It is available to the Root account **only** — the
server refuses every two-factor endpoint for any other role, and the card is not
shown to them. Admin and Project Manager accounts sign in through Microsoft
Entra ID and are covered by its MFA instead.

**Setting it up**

1. Go to **Settings → Profile** and find the **Two-factor authentication** card
2. Enter your **current password** and click **Set up two-factor authentication**
3. Scan the QR code with your authenticator app. If the camera is not an option,
   type the **setup key** in by hand instead — it is the same secret
4. Enter the six-digit code the app now shows and click **Activate**
5. **Write down the ten recovery codes.** This is the only time they are ever
   shown: they are stored hashed, so nobody — not the server, not support — can
   print them again

From the next sign-in on, the password takes you to a second screen asking for a
code. No session exists until that code is accepted.

**Recovery codes**

Each of the ten codes works exactly once, and either the authenticator or a
recovery code will get you in. Use one when your phone is lost, replaced or wiped.
The card under **Settings → Profile** shows how many are left; when the count gets
low, replace the authenticator (below) to be issued a fresh set of ten.

**Replacing the authenticator**

New phone, or a lost one:

1. Sign in — with the old authenticator if you still have it, or with a recovery
   code if you do not
2. Go to **Settings → Profile → Two-factor authentication** and click
   **Replace authenticator**
3. Enter your password **and** a current code or an unused recovery code
4. Scan the new QR code and confirm as above

The old authenticator and the old recovery codes stop working the moment the new
one is confirmed, and a fresh set of ten codes is issued. Until you confirm, the
old one keeps working — starting a replacement and walking away cannot lock you
out.

**It cannot be switched off**

There is no "disable" button and no API endpoint that removes a confirmed second
factor. This is deliberate: an attacker who reached a signed-in session or your
password should not be able to strip the protection off the account. The only way
out is to replace it, or the emergency reset below.

**Emergency reset (operator, database access required)**

If both the authenticator and all ten recovery codes are gone, the account cannot
sign in and no amount of clicking will fix it. Someone with access to the
PostgreSQL database has to clear the second factor. This is an operator
procedure, not a Root one, and every use of it should be recorded in your own
change log — it removes the protection the rest of this section exists to
provide.

Docker Compose:

```sh
docker exec -i ohc-postgres psql -U postgres -d open_hybrid_cloud <<'SQL'
BEGIN;
DELETE FROM user_recovery_codes
  WHERE user_id = (SELECT id FROM users WHERE email = 'root@example.com');
DELETE FROM user_totp
  WHERE user_id = (SELECT id FROM users WHERE email = 'root@example.com');
COMMIT;
SQL
```

Kubernetes:

```sh
kubectl exec -n open-hybrid-cloud deploy/ohc-postgres --   psql -U postgres -d open_hybrid_cloud -c   "DELETE FROM user_recovery_codes WHERE user_id = (SELECT id FROM users WHERE email = 'root@example.com');    DELETE FROM user_totp WHERE user_id = (SELECT id FROM users WHERE email = 'root@example.com');"
```

Replace `root@example.com` with the account's own address. Deleting the
`user_totp` row is what turns the second factor off; deleting the recovery codes
alongside it makes sure no leftover code from the previous enrollment stays
usable. The account then signs in with its password alone, and should enroll again
immediately.

The same procedure applies to an account that was Root when it enrolled and has
since been demoted. Its second factor keeps being required at sign-in — dropping
it silently would remove a protection the owner set up and still relies on — but
it can no longer be replaced through the interface, because replacing it is a
Root-only operation. Either promote the account back to Root, or clear the row as
above.

The same procedure is the way out if `TOTP_ENCRYPTION_KEY` is lost or rotated: the
stored secrets become unreadable, every two-factor sign-in fails closed, and the
enrollment has to be redone.
