// Local-only Playwright config. NOT committed — see the report.
//
// Port 3000 on this machine is held by a different worktree's dev server, so
// this worktree's frontend is served on 3060 and the backend's CORS allowlist
// (FRONTEND_URL in apps/backend/.env) points at it. The shipped config's
// `webServer` blocks would "reuse" whatever is already listening on 3000, which
// would scan somebody else's app, so they are dropped here and the servers are
// started by hand.
import base from './playwright.config'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  ...base,
  webServer: undefined,
  use: { ...base.use, baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3060' },
})
