# GitLab & OpenTofu Integration Guide

This guide explains how to set up the GitLab CI/CD side of the infrastructure workflow. The portal triggers GitLab pipelines via the GitLab Pipeline Trigger API; pipelines run OpenTofu to provision or decommission infrastructure; GitLab pushes pipeline status events back to the portal via a webhook so orders update in real time.

---

## Architecture Overview

```
Portal                          GitLab CI                         Cloud Provider
──────                          ─────────                         ──────────────
Order approved          ──►     POST /infra-templates/trigger/pipeline
                                  TEMPLATE=linode/virtual-machine
                                  TF_STATE_NAME=web-01  TF_ACTION=apply
                        ◄──     {"id": 5678, "status": "pending"}
                                  │  entry pipeline dispatches to template
                                  ├─ validate
                                  ├─ plan  (tofu plan -out=tfplan)
                                  └─ apply (tofu apply tfplan)   ──►  VM created
                                  │
                        ◄──     POST /api/webhooks/gitlab/pipeline
                                  {"status": "success", "pipeline_id": 5678}
Order → completed
OpenTofu outputs stored
E-mail sent to user

Decommission request    ──►     POST /infra-templates/trigger/pipeline
                                  TEMPLATE=linode/virtual-machine
                                  TF_STATE_NAME=web-01  TF_ACTION=destroy
                        ◄──     {"id": 5699}
                                  └─ apply (tofu plan -destroy → tofu apply) ──►  VM deleted
                        ◄──     POST /api/webhooks/gitlab/pipeline
                                  {"status": "success", "pipeline_id": 5699}
Order → decommissioned
E-mail sent to user
```

---

## Repository Structure

All IaC code lives in a single repository, `infra-templates`. It contains reusable OpenTofu modules and deployable product templates. The portal triggers the entry pipeline with a `TEMPLATE` variable; the entry pipeline dispatches to the child pipeline for the named template inside the same repo.

```
infra-templates/
├── .gitlab-ci.yml                        # entry pipeline (dispatch on TEMPLATE)
├── .ci/
│   ├── base.gitlab-ci.yml               # shared validate → plan → apply
│   └── generate_stack.py                # pipeline stack orchestrator
├── modules/                             # reusable OpenTofu building blocks
│   ├── linode-instance/
│   ├── linode-firewall/
│   ├── linode-dns-record/
│   └── vsphere-vm/
└── templates/                           # deployable products
    ├── linode/
    │   ├── virtual-machine/             # instance + per-VM firewall
    │   ├── firewall/
    │   └── dns-record/
    ├── vsphere/
    │   └── virtual-machine/
    └── orchestrator/                    # pipeline stack entry point
```

**Principle:** one trigger → `TEMPLATE` variable → one child pipeline → one OpenTofu state per resource instance. Cross-resource ordering (VM then DNS) is handled by pipeline stacks (Pattern 3) via the orchestrator template.

---

## Step 1: Create a Pipeline Trigger Token

In the `infra-templates` GitLab project:

```
Settings → CI/CD → Pipeline triggers → "Add trigger"
Description: "Infra Webshop"
```

Copy the generated token. You will need it when creating a Deployment Environment in the webshop. One trigger token is sufficient — the `TEMPLATE` variable selects which product template runs.

---

## Triggering Patterns

A single webshop order can require multiple infrastructure resources (e.g. VM + DNS + firewall). There are three patterns:

### Pattern 1 — Single Template Trigger (simplest)

The webshop sends one trigger to `infra-templates` with `TEMPLATE=<name>`. The entry pipeline dispatches to the named template, which provisions a single resource.

```
Webshop
  └── POST /infra-templates/trigger/pipeline
        TEMPLATE=linode/virtual-machine
        TF_STATE_NAME=web-01
        TF_ACTION=apply
              │
              └── trigger: templates/linode/virtual-machine/.gitlab-ci.yml
                    strategy: depend
                    ──► validate → plan → apply
```

**When to use:** one product = one resource type.

---

### Pattern 2 — Multiple Webhooks per Product (advanced)

If teams require the webshop to trigger each resource independently (e.g. different trigger tokens per team), the webshop supports a `product_webhooks` table. See [Multiple Webhooks Extension](#multiple-webhooks-extension-pattern-2) below.

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

## Step 3: Adding a New Template

All CI pipeline logic is provided by `infra-templates`. To add a new product template:

1. Create `templates/<provider>/<name>/` with `main.tf`, `variables.tf`, `outputs.tf`, `backend.tf`.

2. `backend.tf` must declare an empty HTTP backend — configuration is injected at runtime:
   ```hcl
   terraform {
     backend "http" {}
   }
   ```

3. Create `templates/<provider>/<name>/.gitlab-ci.yml`:
   ```yaml
   include:
     - local: .ci/base.gitlab-ci.yml
   variables:
     TEMPLATE_DIR: templates/<provider>/<name>
   ```

4. Register the template in the root `.gitlab-ci.yml`:
   ```yaml
   trigger-<provider>-<name>:
     stage: dispatch
     trigger:
       include:
         - local: templates/<provider>/<name>/.gitlab-ci.yml
       strategy: depend
     rules:
       - if: $TEMPLATE == "<provider>/<name>"
   ```

Key pipeline behaviours provided by `base.gitlab-ci.yml`:

- Product parameters (uppercase CI variables) are automatically promoted to `TF_VAR_<lowercase>` so OpenTofu picks them up without extra `tfvars` files.
- `TF_ACTION=destroy` switches the plan stage to `tofu plan -destroy`; the apply stage runs `tofu apply tfplan` in all cases.
- The apply job's stdout is read by the portal to parse `Outputs:` and store them on the infrastructure element — no extra `tofu output` call needed.
- State is stored in the `infra-templates` project itself via `CI_PROJECT_ID`; no external state backend is required.

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
# templates/linode/virtual-machine/variables.tf

variable "hostname" {
  type        = string
  description = "Instance label and state key — must be unique per resource"
}

variable "region" {
  type        = string
  description = "Linode region (e.g. eu-central, us-east)"
  default     = "eu-central"
}

variable "instance_type" {
  type        = string
  description = "Linode instance plan"
  default     = "g6-nanode-1"
}

variable "image" {
  type        = string
  description = "OS image slug"
  default     = "linode/ubuntu22.04"
}

variable "inbound_ports_csv" {
  type        = string
  description = "Comma-separated TCP ports to allow inbound"
  default     = "22"
}
```

**Naming convention:** variable names in `variables.tf` map directly to CI variable names after uppercasing. `hostname` → `HOSTNAME`, `region` → `REGION`, etc. The base CI promotes them to `TF_VAR_*` automatically.

---

## Step 4b: `outputs.tf`

Define outputs so the portal can surface them on the infrastructure detail page. After `tofu apply` the pipeline prints an `Outputs:` section to stdout; the portal parses it from the job trace and stores the key/value pairs.

```hcl
# templates/linode/virtual-machine/outputs.tf

output "ip_address" {
  description = "Public IPv4 address"
  value       = module.vm.ip_address
}

output "hostname" {
  description = "Instance label"
  value       = module.vm.label
}
```

Only string-valued outputs are captured. Complex types (maps, lists) are ignored by the parser.

---

## Step 5: `backend.tf`

```hcl
# templates/<provider>/<name>/backend.tf

terraform {
  backend "http" {
    # All backend config is injected at runtime by base.gitlab-ci.yml
    # using CI_PROJECT_ID and TF_STATE_NAME.
  }
}
```

GitLab provides a built-in HTTP backend for Terraform/OpenTofu state at:
```
/api/v4/projects/:id/terraform/state/:state_name
```
State is stored in the `infra-templates` project itself — no separate state-hosting project or external storage (S3, GCS) is required.

---

## Step 6: Remote State per Resource Instance

Each resource instance has its own state file. State names are provided by the portal as `TF_STATE_NAME`. For single-template orders this is typically the resource label (e.g. `web-01`). For pipeline stacks, the orchestrator appends per-step suffixes (`web-01-vm`, `web-01-dns`).

To reference outputs from an upstream pipeline stack step:

```hcl
# templates/linode/dns-record/main.tf

data "terraform_remote_state" "vm" {
  backend = "http"
  config = {
    address  = "${var.ci_api_url}/projects/${var.ci_project_id}/terraform/state/${var.vm_state_name}"
    username = "gitlab-ci-token"
    password = var.ci_job_token
  }
}

resource "linode_domain_record" "a" {
  domain_id   = var.domain_id
  name        = var.hostname
  record_type = "A"
  target      = data.terraform_remote_state.vm.outputs.ip_address
}
```

`ci_api_url`, `ci_project_id`, `ci_job_token`, and `vm_state_name` are all exported automatically by the base CI — no manual variable wiring required.

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
| `TEMPLATE` | Template path (for product webhooks) | `linode/virtual-machine` |
| `TF_STATE_NAME` | Unique state key for this resource | `web-01` |
| `TF_ACTION` | Always `apply` on provisioning | `apply` |
| `ORDER_ID` | Order ID from webshop | `99` |
| `HOSTNAME` | Order parameter `hostname` | `web-01` |
| *(any additional parameter)* | Order parameters (uppercased) | |

For pipeline stacks, additionally:

| CI Variable | Source | Example |
|---|---|---|
| `TEMPLATE` | Always `orchestrator` | `orchestrator` |
| `PIPELINE_STACK` | JSON step array from portal | `[{"template":"linode/virtual-machine",...}]` |

### Decommissioning trigger (decommission requested)

| CI Variable | Source | Example |
|---|---|---|
| `TEMPLATE` | Same as at provision time | `linode/virtual-machine` |
| `TF_STATE_NAME` | Same state key as at provision time | `web-01` |
| `TF_ACTION` | Always `destroy` on decommission | `destroy` |
| `INFRA_ID` | Infrastructure element ID | `42` |
| `HOSTNAME` | Stored parameter `hostname` | `web-01` |
| *(all stored parameters)* | Parameters uppercased | |

The CI variable names are derived from the parameter names defined in `variables.tf` — uppercased. Keep parameter names lowercase with underscores (`snake_case`) so they map cleanly to CI variables.

---

## Complete Setup Checklist

```
infra-templates GitLab project setup
  [ ] Create pipeline trigger token (Settings → CI/CD → Pipeline triggers)
  [ ] Set cloud provider credentials as project/group CI/CD variables
        with TF_VAR_ prefix (e.g. TF_VAR_linode_token)
  [ ] For each product: create templates/<provider>/<name>/ with
        main.tf, variables.tf, outputs.tf, backend.tf (empty http block)
  [ ] For each product: create templates/<provider>/<name>/.gitlab-ci.yml
        (include: .ci/base.gitlab-ci.yml, set TEMPLATE_DIR)
  [ ] Register each template in the root .gitlab-ci.yml dispatch block
  [ ] (Optional) Add scheduled pipeline for drift detection

Portal setup
  [ ] Create CI Source (Admin → CI Sources): GitLab URL + access token for repo browsing
  [ ] Create Deployment Environment:
        Webhook URL:   https://gitlab.example.com/api/v4/projects/{infra-templates-ID}/trigger/pipeline
        Webhook Token: the trigger token from the step above
  [ ] Create product, link to environment, set price
  [ ] Import parameters from variables.tf via Browse Repository
        (Admin → Products → Edit → Browse Repository → select variables.tf → Import)
  [ ] On the product edit page, configure either:
        • A Product Webhook with TEMPLATE=<provider>/<name> as a fixed variable, OR
        • A Pipeline Stack for multi-step provisioning

GitLab webhook setup (callback to portal)
  [ ] In the infra-templates GitLab project: Settings → Webhooks → Add new webhook
        URL:          https://your-portal.example.com/api/webhooks/gitlab/pipeline
        Secret token: the Webhook Token set in the portal environment above
        Trigger:      Pipeline events (enable only this one)
        SSL:          enable

Verification
  [ ] Place a test order → pipeline triggered → pipeline_id stored on order
  [ ] Entry pipeline dispatches to the correct template → validate/plan/apply runs
  [ ] GitLab sends webhook on completion → order status → "completed"
  [ ] OpenTofu outputs appear on the infrastructure detail page
  [ ] Check cloud console: resource exists
  [ ] Test decommission → pipeline with TF_ACTION=destroy → status "decommissioned"
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
| `vm` | `10` | `.../repo-a/trigger/pipeline` |
| `dns` | `20` | `.../repo-b/trigger/pipeline` |
| `firewall` | `20` | `.../repo-c/trigger/pipeline` |

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
| Step sequence needs to change per product without touching CI YAML | **Pipeline Stacks** — portal defines the DAG as data |

---

## Pattern 3 — Portal-Configured Pipeline Stacks

Pipeline Stacks are the built-in successor to the manual orchestrator YAML pattern. Instead of hard-coding the step sequence in `.gitlab-ci.yml`, the portal stores an ordered list of template steps per product+environment in the `pipeline_stacks` database table and passes the entire plan to a generic orchestrator pipeline at trigger time.

### How it works

When an order is approved (or placed directly by an Admin), the portal fires `triggerPipelineStacks()` alongside `triggerProductWebhooks()`. For each pipeline stack configured for the product+environment, it sends one HTTP POST to the stack's webhook URL with the following CI variables:

| CI Variable | Value |
|---|---|
| `TEMPLATE` | `orchestrator` |
| `TF_STATE_NAME` | Value of the order parameter named by `stateKeyParam` (e.g. `hostname` → `my-vm-01`) |
| `PIPELINE_STACK` | JSON array of step objects (see below) |
| `ORDER_ID` | Webshop order ID |
| *(all other order parameters)* | Uppercased, same as product webhooks |

### PIPELINE_STACK format

```json
[
  {
    "template": "linode/virtual-machine",
    "stateSuffix": "-vm"
  },
  {
    "template": "linode/dns-record",
    "stateSuffix": "-dns",
    "upstreamSuffix": "-vm"
  },
  {
    "template": "linode/firewall",
    "stateSuffix": "-fw",
    "fixedParams": { "FW_POLICY": "drop" }
  }
]
```

Each step object:

| Field | Required | Description |
|---|---|---|
| `template` | Yes | Path to the template in the infra-templates repository (e.g. `linode/virtual-machine`) |
| `stateSuffix` | Yes | Appended to `TF_STATE_NAME` to form the unique OpenTofu state key for this step (`my-vm-01-vm`) |
| `upstreamSuffix` | No | State suffix of a preceding step whose outputs this step depends on; the orchestrator resolves cross-step data passing |
| `fixedParams` | No | Additional CI variables sent only to this step, merged with the shared order parameters |

### stateKeyParam

`stateKeyParam` (default: `hostname`) names the order parameter used as the base Terraform state key. It must be:
- **Stable** — the same value must be submitted at provision time and is stored on the infrastructure element for use at destroy time
- **Unique per infrastructure element** — so state files never collide across concurrent orders

Example: if `stateKeyParam = "hostname"` and the order sets `hostname = "my-vm-01"`, then the state keys across steps are `my-vm-01-vm`, `my-vm-01-dns`, `my-vm-01-fw`.

### Orchestrator pipeline

The orchestrator pipeline in GitLab reads `PIPELINE_STACK` and dynamically generates child pipeline triggers. A minimal implementation:

```yaml
# infra/orchestrator/.gitlab-ci.yml

orchestrate:
  image: python:3.12-alpine
  script:
    - python scripts/run_stack.py
  variables:
    PIPELINE_STACK: $PIPELINE_STACK
    TF_STATE_NAME:  $TF_STATE_NAME
    ORDER_ID:       $ORDER_ID
```

`run_stack.py` parses `PIPELINE_STACK`, iterates the steps in order, calls `POST /projects/:id/trigger/pipeline` for each template pipeline, waits for completion (using `depends:`), and propagates `DESTROY` when set.

### Configuring in the portal

See the Root Guide, section 4.5 "Pipeline Stacks" for step-by-step instructions on creating and managing stacks in the portal UI.

### When to use Pipeline Stacks vs. other patterns

| Factor | Orchestrator YAML | Multiple Webhooks | Pipeline Stacks |
|---|---|---|---|
| Step order | Defined in `.gitlab-ci.yml` | Defined in portal | Defined in portal |
| Adding a step | Edit YAML, redeploy | Add row in portal | Add step in portal |
| Cross-step data passing | GitLab artifacts | Not supported | Via `upstreamSuffix` |
| Multiple trigger tokens | Not needed (one project) | One per team | One per stack |
| Destroy | `DESTROY` propagated via YAML | Each webhook receives `DESTROY` | `DESTROY` propagated via stack JSON |
| Best for | Stable infra topology, one team | Many independent teams | Frequently changing products, no CI YAML ownership |
