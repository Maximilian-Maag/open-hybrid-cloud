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

Open an issue with minimal details and clearly mark it as a security concern.  
Do **not** post exploit code, tokens, credentials, or sensitive infrastructure data in public.

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
