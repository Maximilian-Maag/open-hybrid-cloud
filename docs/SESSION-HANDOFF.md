# Session handoff — paused 2026-08-24 for transfer to office

This file is deliberately **untracked** and does not travel with you. Everything
that matters is on the remote: all branches are pushed, and the findings are
GitHub issues. This is only a local index.

## State at the pause

All nine subagents and both CI monitors were stopped. Four worktrees had
uncommitted work; it is committed as `wip:` snapshots and pushed. **Those
snapshots are not verified — gates were not run on them.**

| Branch | Pushed | Note |
|---|---|---|
| `chore/stricter-lint` | ✅ | |
| `feat/aaa-conformance` | ✅ | wip snapshot; new `bootstrap/brandingContrast.ts` |
| `fix/issue-152-154-156-157-e2e` | ✅ | wip snapshot |
| `fix/issue-185-186-a11y` | ✅ | wip snapshot; adds `playwright.local.ts` |
| `fix/issue-183-ci-variables` | ⚠️ | diverged — see below |
| `fix/issue-184-189-money-sessions` | ⚠️ | diverged — see below |

Both diverged branches are backed up on the remote at
`wip-local/<branch>`; nothing is lost, but they need a manual reconcile:

- `fix/issue-183-ci-variables` — local is ahead 7 / behind 2. The remote has
  `f6def42 chore: renumber to 0026, 0025 is taken by the callback-secret rotation`,
  which is the migration renumber. **Take the remote's renumber**, do not force-push over it.
- `fix/issue-184-189-money-sessions` — local ahead 1 / behind 2, both sides WIP.

## Open PRs, auto-merge armed

#174 product page · #191 PaC gate · #192 CI variables · #194 migration journal

**#194 matters most.** Five journal entries share `when=1787702400000`, and
drizzle's comparison is a strict `<` (`pg-core/dialect.js:62`), so once idx 20
applies, **0022–0025 are silently skipped** — including the callback-secret
rotation from #190. Still unmerged, so `dev` still has the collision.

## Filed at the pause

- **#195** — fifteen defects at the seams between the twenty PRs merged on 2026-08-23.
  Ranked; if only three get done: `deleteCategory` erasing orders, the
  `createDelegation` deadlock (ship the `setup.ts` FK with it), and the
  parallel-bypassable TOTP lockout.
- **#196** — root admin cannot sign in to the **deployed** dev instance. Best
  candidate: a successful sign-in spends **two** attempts from the per-IP
  rate-limit bucket (the `challengeOnly` hop plus the real one) and never gets
  them back, so it is five sign-ins per IP per 15 minutes. Only bites where
  `TRUST_PROXY` is set, which is why it does not reproduce locally.
  **Needs from the owner:** the status and body of the failing login POST.
- **#197** — force second-factor enrolment for admins, and add WebAuthn/Yubikey.
  **Blocked on one answer:** which roles must enrol — `root` only, or all
  administrative roles?

## Local environment notes

- The main checkout is **75 commits behind `origin/dev`**. `git pull` before doing anything here.
- The local dev database was built by `drizzle-kit push`, not `migrate` —
  `drizzle.__drizzle_migrations` does not exist. It therefore proves nothing
  about migration correctness.
- Running locally: `ohc-postgres`, `ohc-wiremock`, `ohc-structurizr`, `ohc-mailpit`,
  and a backend on `:3001`. Nothing on `:3000`.
