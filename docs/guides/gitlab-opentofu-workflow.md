# GitLab & OpenTofu Integration Guide

This guide explains how to set up the GitLab CI/CD side of the infrastructure workflow. The portal triggers GitLab pipelines via the GitLab Pipeline Trigger API; pipelines run OpenTofu to provision or decommission infrastructure; GitLab pushes pipeline status events back to the portal via a webhook so orders update in real time.

---

## Architecture Overview

```
Portal                          GitLab CI                         Cloud Provider
──────                          ─────────                         ──────────────
Order approved          ──►     POST /trigger/pipeline
                        ◄──     {"id": 5678, "status": "pending"}
                                  │
                                  ├─ validate
                                  ├─ plan  (tofu plan -out=plan.tfplan)
                                  └─ apply (tofu apply plan.tfplan)   ──►  VM + DNS created
                                  │
                        ◄──     POST /api/webhooks/gitlab/pipeline
                                  {"status": "success", "pipeline_id": 5678}
Order → completed
OpenTofu outputs stored
E-mail sent to user

Decommission request    ──►     POST /trigger/pipeline (DESTROY=true)
                        ◄──     {"id": 5699}
                                  └─ apply (tofu destroy)             ──►  VM deleted
                        ◄──     POST /api/webhooks/gitlab/pipeline
                                  {"status": "success", "pipeline_id": 5699}
Order → decommissioned
E-mail sent to user
```

---

## Repository Structure

Organise infrastructure repositories by lifecycle / platform, not by individual resource type. Each repository manages one business object end-to-end (VM, DNS record, firewall rule).

| Repository | Manages | Examples |
|---|---|---|
| `infra/vm-platform` | Virtual machines and related resources | Linodes, DNS entries, firewall rules |
| `infra/k8s-platform` | Kubernetes clusters and apps | LKE cluster, Ingress DNS, K8s firewall |
| `infra/network-core` | Shared network foundations | VPC, VLANs, global DNS zones |
| `infra/observability` | Monitoring & logging *(optional)* | Grafana, Loki, alerts |
| `infra/shared-services` | Shared internal services *(optional)* | GitLab, Vault, object storage |

**Principle:** one webhook trigger → one repository → one OpenTofu state. If a VM needs DNS and a firewall rule, all three belong in `vm-platform` — no cross-repository triggers needed.

---

## Step 1: Create a Pipeline Trigger Token

In each GitLab infrastructure project:

```
Settings → CI/CD → Pipeline triggers → "Add trigger"
Description: "Infra Webshop"
```

Copy the generated token. You will need it when creating a Deployment Environment in the webshop.

---

## Multi-Repository Products

A single webshop product (e.g. "VM") often maps to resources managed in **multiple GitLab repositories**: one for the VM platform, one for DNS, one for firewall rules. The webshop currently supports one webhook URL per deployment environment. There are two patterns to handle this:

### Pattern 1 — GitLab Orchestrator Pipeline (recommended)

Create a thin **orchestrator project** per product (e.g. `infra/vm-orchestrator`). Its pipeline uses GitLab's built-in `trigger:` keyword to launch child pipelines in the individual platform repos **in sequence**. The webshop webhook URL points to the orchestrator — it stays unaware of the internal repo split.

```
Webshop
  └── POST /vm-orchestrator/trigger/pipeline   (one webhook)
        │
        ├── trigger: vm-platform    ──► tofu apply (VM created, outputs IP)
        │     strategy: depend
        └── trigger: dns-platform   ──► tofu apply (DNS record → VM IP)
              strategy: depend
              needs: [trigger:vm-platform]
```

**Orchestrator `.gitlab-ci.yml`:**

```yaml
# infra/vm-orchestrator/.gitlab-ci.yml

stages:
  - infrastructure
  - networking

vm:
  stage: infrastructure
  trigger:
    project: infra/vm-platform
    branch: main
    strategy: depend        # wait for child pipeline before proceeding
  variables:
    ORDER_ID:  $ORDER_ID
    INFRA_ID:  $INFRA_ID
    DESTROY:   $DESTROY
    NAME:      $NAME
    SIZE:      $SIZE

dns:
  stage: networking
  trigger:
    project: infra/dns-platform
    branch: main
    strategy: depend
  variables:
    ORDER_ID:  $ORDER_ID
    INFRA_ID:  $INFRA_ID
    DESTROY:   $DESTROY
    NAME:      $NAME
    DOMAIN:    $DOMAIN
  needs: [vm]               # DNS runs after VM stage completes
```

**Advantages:**
- Zero webshop code changes — one webhook URL, one pipeline ID for polling
- GitLab handles sequencing, retries, and failure propagation
- Adding another repo (e.g. monitoring) means editing one YAML file
- `DESTROY=true` is propagated automatically to all child pipelines
- Child pipeline outputs (e.g. VM IP) can be passed to later stages via [GitLab pipeline artifacts](https://docs.gitlab.com/ee/ci/pipelines/downstream_pipelines.html#pass-artifacts-to-a-downstream-pipeline)

**Webshop configuration:** the `WebhookURL` for the environment points to the **orchestrator project**, not to `vm-platform` directly.

---

### Pattern 2 — Multiple Webhooks per Product (advanced)

If teams require the webshop to trigger each repository independently (e.g. different trigger tokens per team), the webshop can be extended with a `product_webhooks` table. See [Multiple Webhooks Extension](#multiple-webhooks-extension-pattern-2) below.

---

## Step 2: Configure the Webshop Environment

In the webshop under **Admin → Environments**, create one environment per target:

| Field | Value |
|---|---|
| **Webhook URL** | `https://gitlab.example.com/api/v4/projects/{PROJECT_ID}/trigger/pipeline` |
| **Webhook Token** | The trigger token from Step 1 |

The `{PROJECT_ID}` is the numeric GitLab project ID, visible under **Settings → General** in GitLab.

> **Multiple environments:** Use separate trigger tokens (or separate branches) for `production` and `staging`. Point both webhook URLs to the same project; control the target branch via the `ref` field — the webshop always sends `ref: main`. Use GitLab CI rules or a separate branch per environment to separate concerns.

---

## Step 3: `.gitlab-ci.yml`

A complete ready-to-use pipeline file is provided at [`docs/guides/cd-pipeline.yml`](./cd-pipeline.yml). Copy it to your infrastructure repository as `.gitlab-ci.yml`.

Key points:

- All order parameters arrive as CI variables (uppercased), written into `order.auto.tfvars` so OpenTofu picks them up automatically.
- `DESTROY=true` is set by the portal on decommission triggers — the plan job uses it to run `tofu plan -destroy`.
- The apply job ends with `tofu output` so the portal can parse outputs from the job trace and store them against the infrastructure element.
- `rules: - if: $CI_PIPELINE_SOURCE == "trigger"` ensures only portal-triggered runs execute the provisioning jobs; scheduled runs execute the drift check instead.

```yaml
apply:
  stage: apply
  script:
    - tofu apply plan.tfplan
    # tofu output prints the "Outputs:" section — the portal reads this from
    # the job trace and stores key/value pairs on the infrastructure element.
    - tofu output
  dependencies: [plan]
  rules:
    - if: $CI_PIPELINE_SOURCE == "trigger"
```

---

## Step 3b: Set Up the GitLab Webhook (callback to portal)

After the pipeline finishes, GitLab must notify the portal so the order or infrastructure element status updates. This is done via a GitLab **Pipeline webhook**.

**In each GitLab infrastructure project:**

```
Settings → Webhooks → Add new webhook
```

| Field | Value |
|---|---|
| **URL** | `https://your-portal.example.com/api/webhooks/gitlab/pipeline` |
| **Secret token** | The **Webhook Token** from the portal environment (Admin → Environments → edit) |
| **Trigger** | Enable **Pipeline events** only |
| **SSL verification** | Enable (requires a valid TLS certificate on the portal) |

The portal's webhook receiver (`POST /api/webhooks/gitlab/pipeline`) verifies the `X-Gitlab-Token` header against all stored environment webhook tokens. If no matching token is found the request is rejected with `401`.

**How the callback is processed:**

1. GitLab sends a `pipeline` event payload for every status transition (`pending`, `running`, `success`, `failed`, `canceled`).
2. The portal maps the GitLab status to its internal `PipelineEvent` type.
3. On `success`: the portal looks up orders in `provisioning` state or infra elements in `decommissioning` state with a matching pipeline ID, transitions their status, fetches the job trace, parses OpenTofu outputs, and sends email notifications.
4. On `failed` / `canceled`: the portal transitions orders to `failed` and logs an audit entry.
5. Intermediate statuses (`pending`, `running`) are received but produce no state changes — they keep the portal informed without side effects.

> **No polling.** The portal does not poll GitLab. All status updates are push-based via this webhook. Ensure the portal is publicly reachable from your GitLab instance (or that the GitLab instance can reach the portal's internal address).

---

## Step 4: `variables.tf`

Define one variable per parameter that the webshop can pass. This file is also used by the webshop's **Browse Repository** feature (Admin → Products → Import variables.tf) to automatically create the matching product parameters.

```hcl
# infra/vm-platform/variables.tf

variable "order_id" {
  type        = string
  description = "Reference to the webshop order"
}

variable "name" {
  type        = string
  description = "Unique resource name (used for Linode label and DNS)"
}

variable "domain" {
  type        = string
  description = "Fully qualified domain name for the DNS entry"
}

variable "size" {
  type        = string
  description = "VM size: small | medium | large"
  default     = "small"
}
```

**Naming convention:** variable names in `variables.tf` map directly to CI variable names after uppercasing. `name` → `NAME`, `domain` → `DOMAIN`, etc. The portal sends them this way automatically.

---

## Step 4b: `outputs.tf`

Define outputs so the portal can surface them on the infrastructure detail page. After `tofu apply` the pipeline prints an `Outputs:` section to stdout; the portal parses it from the job trace and stores the key/value pairs.

```hcl
# infra/vm-platform/outputs.tf

output "ip_address" {
  description = "Public IP of the provisioned VM"
  value       = linode_instance.vm.ip_address
}

output "hostname" {
  description = "Fully qualified hostname"
  value       = "${var.name}.${var.domain}"
}
```

Only string-valued outputs are captured. Complex types (maps, lists) are ignored by the parser.

---

## Step 5: `backend.tf`

```hcl
# infra/vm-platform/backend.tf

terraform {
  backend "http" {
    # All backend config is injected at runtime via tofu init -backend-config=...
    # See the .tofu_base before_script in .gitlab-ci.yml
  }
}
```

GitLab provides a built-in HTTP backend for Terraform/OpenTofu state at:
```
/api/v4/projects/:id/terraform/state/:state_name
```
No separate state storage server (S3, GCS, etc.) is required.

---

## Step 6: Remote State per Repository

Each infrastructure repository has its own state file. This ensures independent locking, clear ownership, and drift detection per module.

| Repository | State Name |
|---|---|
| `vm-platform` | `vm-prod` / `vm-staging` |
| `k8s-platform` | `k8s-prod` / `k8s-staging` |
| `network-core` | `network-prod` |

To reference outputs from another module (e.g. `network-core` subnet IDs in `vm-platform`):

```hcl
# infra/vm-platform/data.tf

data "terraform_remote_state" "network" {
  backend = "http"
  config = {
    address  = "${var.gitlab_api_url}/projects/${var.network_project_id}/terraform/state/network-prod"
    username = "gitlab-ci-token"
    password = var.gitlab_token
  }
}

# Use it:
resource "linode_instance" "vm" {
  # ...
  subnet_id = data.terraform_remote_state.network.outputs.default_subnet_id
}
```

---

## Step 7: Drift Management

Drift occurs when infrastructure is changed manually (e.g. directly in the Linode web console) instead of through the pipeline.

**Detecting drift:**

Add a scheduled pipeline to run `tofu plan` without applying:

```yaml
# In .gitlab-ci.yml — add to the plan job:
drift_check:
  extends: .tofu_base
  stage: plan
  script:
    - tofu plan -detailed-exitcode   # exits 2 if drift detected
  allow_failure: true
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
```

Configure the schedule under **CI/CD → Schedules** (e.g. daily at 06:00).

**Resolving drift:**

- **Preferred:** Update the OpenTofu code to match the intended state, then let the pipeline re-apply.
- **Emergency:** Run `tofu apply` from the pipeline to revert manual changes.
- **Never** make persistent changes directly in the cloud console — they will be overwritten on the next pipeline run.

---

## Variable Reference

The webshop sends the following CI variables with every pipeline trigger:

### Provisioning trigger (order approved)

| CI Variable | Source | Example |
|---|---|---|
| `ORDER_ID` | Order ID from webshop | `99` |
| `NAME` | Order parameter `name` | `proj-customer-123` |
| `DOMAIN` | Order parameter `domain` | `app.example.com` |
| `SIZE` | Order parameter `size` | `medium` |
| *(any additional parameter)* | Order parameters (uppercased) | |

### Decommissioning trigger (decommission requested)

| CI Variable | Source | Example |
|---|---|---|
| `INFRA_ID` | Infrastructure element ID | `42` |
| `DESTROY` | Always `true` | `true` |
| `NAME` | Stored parameter `name` | `proj-customer-123` |
| *(all stored parameters)* | Parameters uppercased | |

The CI variable names are derived from the parameter names defined in `variables.tf` — uppercased. Keep parameter names lowercase with underscores (`snake_case`) so they map cleanly to CI variables.

---

## Complete Setup Checklist

```
GitLab project setup
  [ ] Create pipeline trigger token (Settings → CI/CD → Pipeline triggers)
  [ ] Copy docs/guides/cd-pipeline.yml to the repo as .gitlab-ci.yml
  [ ] Add backend.tf with http backend (no config — injected at runtime)
  [ ] Add variables.tf with all expected parameters
  [ ] Add outputs.tf to expose resource attributes (IP, hostname, etc.)
  [ ] Add main OpenTofu resources (provider, resources)
  [ ] (Optional) Add scheduled pipeline for drift detection

Portal setup
  [ ] Create CI Source (Admin → CI Sources): GitLab URL + access token for repo browsing
  [ ] Create Deployment Environment:
        Webhook URL:   https://gitlab.example.com/api/v4/projects/{ID}/trigger/pipeline
        Webhook Token: a secret string you choose — you will set the same value in GitLab
  [ ] Create product, link to environment, set price
  [ ] Import parameters from variables.tf via Browse Repository
        (Admin → Products → Edit → Browse Repository → select variables.tf → Import)

GitLab webhook setup (callback to portal)
  [ ] In the GitLab project: Settings → Webhooks → Add new webhook
        URL:          https://your-portal.example.com/api/webhooks/gitlab/pipeline
        Secret token: the Webhook Token set in the portal environment above
        Trigger:      Pipeline events (enable only this one)
        SSL:          enable

Verification
  [ ] Place a test order → pipeline triggered → pipeline_id stored on order
  [ ] GitLab pipeline runs → sends webhook on completion → order status → "completed"
  [ ] OpenTofu outputs appear on the infrastructure detail page
  [ ] Check cloud console: resource exists
  [ ] Test decommission → pipeline with DESTROY=true → status "decommissioned"
```

---

## Multiple Webhooks Extension (Pattern 2)

> Use this only when the orchestrator pattern is not feasible — e.g. when each infrastructure team manages its own trigger token and the webshop must call each repo directly.

### Data Model

A new `product_webhooks` table stores an ordered list of webhook endpoints per product+environment combination. The webshop fires them all on order approval or decommission.

```sql
-- migration: 006_product_webhooks.sql
CREATE TABLE product_webhooks (
    id             BIGSERIAL PRIMARY KEY,
    product_id     BIGINT NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
    environment_id BIGINT NOT NULL REFERENCES deployment_environments(id),
    name           TEXT NOT NULL,           -- e.g. "vm-platform", "dns"
    webhook_url    TEXT NOT NULL,
    webhook_token  TEXT NOT NULL,
    exec_order     INT  NOT NULL DEFAULT 0  -- lower = earlier; equal = parallel
);

CREATE INDEX idx_product_webhooks ON product_webhooks(product_id, environment_id, exec_order);
```

### Execution Model

| `exec_order` | Behaviour |
|---|---|
| Same value for multiple rows | Triggered in parallel, all pipeline IDs stored |
| Different values | Triggered in sequence (wait for all at order N before starting N+1) |

Example for the "VM" product in Production:

| name | exec_order | webhook_url |
|---|---|---|
| `vm-platform` | `10` | `.../vm-platform/trigger/pipeline` |
| `dns-platform` | `20` | `.../dns-platform/trigger/pipeline` |
| `firewall` | `20` | `.../firewall/trigger/pipeline` |

VM provisions first (order 10), then DNS and firewall in parallel (both order 20).

### Pipeline ID Tracking

Because multiple pipelines run per order, the single `pipeline_id` column is extended to a JSON array:

```sql
-- included in 006_product_webhooks.sql
ALTER TABLE orders ALTER COLUMN pipeline_id TYPE JSONB USING
    CASE WHEN pipeline_id = '' THEN '[]'::jsonb
         ELSE jsonb_build_array(pipeline_id)
    END;
ALTER TABLE orders ALTER COLUMN pipeline_id SET DEFAULT '[]';
```

The order is considered **completed** when all stored pipeline IDs reach `success`; **failed** when any reaches `failed` or `canceled`.

### Root UI

The product edit page (`Admin → Products → Edit`) gains a **Webhooks** section per environment where the admin can add, reorder, and delete webhook entries. This replaces the single webhook URL that is currently on the `DeploymentEnvironment`.

> **Note:** If `product_webhooks` rows exist for a product+environment, they take precedence over the environment's default `webhook_url`. This keeps existing single-webhook setups working without migration.

### When to Use Which Pattern

| Scenario | Recommended pattern |
|---|---|
| One team owns all infra repos | **Orchestrator** — GitLab CI handles the DAG |
| Multiple teams, separate trigger tokens | **Multiple Webhooks** — webshop controls the call order |
| Repos have hard dependencies (VM IP → DNS) | **Orchestrator** — `needs:` and artifacts handle data passing |
| Each webhook needs different parameters | **Multiple Webhooks** — webshop can send per-webhook variable sets |
| Simplest possible setup | **Orchestrator** — fewest moving parts |
