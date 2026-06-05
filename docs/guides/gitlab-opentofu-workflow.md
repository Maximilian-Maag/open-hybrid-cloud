# GitLab & OpenTofu Integration Guide

This guide explains how to set up the GitLab CI/CD side of the infrastructure workflow. The webshop triggers GitLab pipelines via the GitLab Pipeline Trigger API; pipelines run OpenTofu to provision or decommission infrastructure; the webshop polls pipeline status to update orders automatically.

---

## Architecture Overview

```
Webshop                         GitLab CI                         Cloud Provider
───────                         ─────────                         ──────────────
Order approved          ──►     POST /trigger/pipeline
                        ◄──     {"id": 5678, "status": "pending"}
                                  │
                                  ├─ validate
                                  ├─ plan (tofu plan -out=plan.tfplan)
                                  └─ apply (tofu apply plan.tfplan)   ──►  VM + DNS created

Polling every 30s       ──►     GET /pipelines/5678
                        ◄──     {"status": "success"}
Order → completed
E-mail sent to user

Decommission request    ──►     POST /trigger/pipeline (DESTROY=true)
                        ◄──     {"id": 5699}
Polling → success       ──►     Order → decommissioned              ──►  VM deleted
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

This pipeline receives all order parameters as CI/CD variables from the webshop trigger and runs OpenTofu accordingly. `DESTROY=true` switches from provisioning to decommissioning.

```yaml
# infra/vm-platform/.gitlab-ci.yml

stages:
  - validate
  - plan
  - apply

# GitLab Managed Terraform State — no separate backend server required
variables:
  TF_STATE_NAME: "vm-${CI_COMMIT_REF_SLUG}"   # e.g. vm-main, vm-staging
  TF_ADDRESS: "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/terraform/state/${TF_STATE_NAME}"

.tofu_base:
  image: ghcr.io/opentofu/opentofu:1.8
  before_script:
    # Write webshop order parameters into a .tfvars file
    - |
      cat > order.auto.tfvars <<EOF
      order_id = "${ORDER_ID}"
      name     = "${NAME}"
      domain   = "${DOMAIN}"
      size     = "${SIZE:-small}"
      EOF
    # Initialise OpenTofu with GitLab HTTP backend for remote state
    - |
      tofu init \
        -backend-config="address=${TF_ADDRESS}" \
        -backend-config="lock_address=${TF_ADDRESS}/lock" \
        -backend-config="unlock_address=${TF_ADDRESS}/lock" \
        -backend-config="username=gitlab-ci-token" \
        -backend-config="password=${CI_JOB_TOKEN}" \
        -backend-config="lock_method=POST" \
        -backend-config="unlock_method=DELETE"

validate:
  extends: .tofu_base
  stage: validate
  script:
    - tofu validate
  rules:
    - if: $CI_PIPELINE_SOURCE == "trigger"

plan:
  extends: .tofu_base
  stage: plan
  script:
    - |
      if [ "${DESTROY}" = "true" ]; then
        tofu plan -destroy -out=plan.tfplan
      else
        tofu plan -out=plan.tfplan
      fi
  artifacts:
    paths: [plan.tfplan]
    expire_in: 1 hour
  rules:
    - if: $CI_PIPELINE_SOURCE == "trigger"

apply:
  extends: .tofu_base
  stage: apply
  script:
    - tofu apply plan.tfplan
  dependencies: [plan]
  rules:
    - if: $CI_PIPELINE_SOURCE == "trigger"
```

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

**Naming convention:** variable names in `variables.tf` map directly to CI variable names after uppercasing. `name` → `NAME`, `domain` → `DOMAIN`, etc. The webshop sends them this way automatically.

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
  [ ] Add .gitlab-ci.yml with validate / plan / apply stages
  [ ] Add backend.tf with http backend (no config — injected at runtime)
  [ ] Add variables.tf with all expected parameters
  [ ] Add main OpenTofu resources (provider, resources, outputs)
  [ ] (Optional) Add scheduled pipeline for drift detection

Webshop setup
  [ ] Create GitLab Source (Admin → Sources): URL + access token for repo browsing
  [ ] Create Deployment Environment:
        Webhook URL:   https://gitlab.example.com/api/v4/projects/{ID}/trigger/pipeline
        Webhook Token: trigger token from above
  [ ] Create product, link to environment, set price
  [ ] Import parameters from variables.tf via Browse Repository
        (Admin → Products → Edit → Browse Repository → select variables.tf → Import)

Verification
  [ ] Place a test order → pipeline triggered → pipeline_id stored
  [ ] Wait for polling cycle (≤30s) → order status updates to "completed"
  [ ] Check GitLab pipeline passed and resource exists in cloud console
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
