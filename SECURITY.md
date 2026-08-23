# Security Policy

## Supported Versions

Security fixes are provided for actively maintained branches:

| Branch | Status |
| --- | --- |
| `main` | ✅ Supported |
| `staging` | ✅ Supported |
| `dev` | ✅ Supported (best effort) |
| Other branches/tags | ❌ Not supported |

## Reporting a Vulnerability

Please report suspected vulnerabilities **privately**.

### Preferred

Use GitHub's private vulnerability reporting for this repository ("Security" tab → "Report a vulnerability").

### If private reporting is unavailable

**Do not open a public issue.** A public issue discloses that a vulnerability exists
and which component it affects, which is enough to put deployments at risk even with
no exploit code attached.

Instead, ask for a private channel without describing the problem: contact the
repository maintainer through the contact details on their GitHub profile, saying
only that you have a security report and need somewhere private to send it. Withhold
the description, the reproduction and any proof-of-concept until that channel exists.

If you are unsure whether something is a security issue, treat it as one until a
maintainer tells you otherwise — the cost of asking privately is nothing, and the
cost of guessing wrong in public is not.

## What to Include

Please include:

- A clear description of the issue and affected component(s)
- Steps to reproduce
- Impact assessment (what an attacker can do)
- Any proof-of-concept details (shared privately)
- Suggested mitigation (if available)

## Response Expectations

- Initial triage acknowledgement target: **within 3 business days**
- Confirmed vulnerabilities will be prioritized by severity and fixed in supported branches
- We will coordinate disclosure timing with the reporter when possible

## Security Baseline for Deployments

When deploying Open Hybrid Cloud:

- Set strong secrets for `JWT_SECRET` and `NEXTAUTH_SECRET` (minimum 32 characters)
- Protect and rotate `DECOMMISSION_SWEEP_SECRET`, webhook callback secrets, and CI tokens
- Never commit `.env` files or other plaintext secrets
- Restrict access to admin/root accounts and enforce least privilege
- Keep dependencies and container images up to date

## Scope

This policy covers:

- Backend API (`apps/backend`)
- Frontend (`apps/frontend`)
- Shared packages (`packages/*`)
- Infrastructure and deployment assets (`infra/*`, workflow files)
