import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * The reverse proxy has to know which /api paths are NOT the backend's.
 *
 * Both apps are Next.js and both serve routes under /api. The proxy splits them
 * by path, which means the split is a hand-maintained copy of a fact that lives
 * in the frontend's file tree — and #196 is what happens when the copy falls
 * behind: #36 added `/api/login-challenge` to the frontend, neither proxy config
 * learned about it, and every sign-in on the deployed instance got a 404 from
 * the backend. It carried the backend's CORS headers, which is how it was
 * finally attributed.
 *
 * So: derive the list from the frontend build, and fail if either config is
 * missing one. This is the gate that #196 did not have.
 *
 * Both configs are checked, because they are deployed independently and were
 * wrong in DIFFERENT ways — the Helm ingress sent all of /api to the backend
 * including NextAuth, while nginx.conf.example had already special-cased
 * /api/auth/ and only missed the two routes added after it was written.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const API_DIR = path.join(REPO_ROOT, 'apps/frontend/src/app/api')
const INGRESS = path.join(REPO_ROOT, 'infra/helm/open-hybrid-cloud/templates/ingress.yaml')
const NGINX = path.join(REPO_ROOT, 'infra/docker-host/nginx.conf.example')

/**
 * Every /api path the frontend actually serves, as the proxy sees it.
 *
 * A dynamic segment (`[...nextauth]`) is not a path the proxy can match, so the
 * route contributes its parent prefix instead: `/api/auth/[...nextauth]` is
 * `/api/auth`, which is what has to be routed.
 */
function frontendApiPaths(dir = API_DIR, prefix = '/api'): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      // A dynamic segment stops the walk: everything below it is served by the
      // same prefix, and the proxy cannot match on it anyway.
      if (entry.startsWith('[')) {
        found.push(prefix)
        continue
      }
      found.push(...frontendApiPaths(full, `${prefix}/${entry}`))
    } else if (entry === 'route.ts' || entry === 'route.tsx') {
      found.push(prefix)
    }
  }
  return [...new Set(found)]
}

/** Paths the Helm ingress sends to the FRONTEND service. */
function ingressFrontendPaths(): string[] {
  const src = readFileSync(INGRESS, 'utf8')
  const list = /range \$path := list ([^}]*)}}/.exec(src)
  if (!list) return []
  return [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/** Paths nginx.conf.example proxies to the frontend upstream. */
function nginxFrontendPaths(): string[] {
  const src = readFileSync(NGINX, 'utf8')
  const paths: string[] = []
  // `location [=] /some/path {` … `}` — keep the ones whose body goes to the
  // frontend. Non-greedy to the first closing brace at column 8, which is how
  // every block in this file is indented.
  for (const m of src.matchAll(/location\s+(=\s+)?(\/[^\s{]*)\s*\{([\s\S]*?)\n {8}\}/g)) {
    if (m[3].includes('$frontend_upstream')) paths.push(m[2].replace(/\/$/, '') || '/')
  }
  return paths
}

describe('the proxy configs know which /api routes are the frontend’s', () => {
  const served = frontendApiPaths()

  it('finds the frontend’s own /api routes', () => {
    // Guards the walk itself: a change that made this return nothing would make
    // every assertion below vacuously pass.
    expect(served).toContain('/api/login-challenge')
    expect(served).toContain('/api/auth')
    expect(served.length).toBeGreaterThanOrEqual(3)
  })

  it.each(frontendApiPaths())('the Helm ingress routes %s to the frontend', (p) => {
    expect(ingressFrontendPaths()).toContain(p)
  })

  it.each(frontendApiPaths())('nginx.conf.example proxies %s to the frontend', (p) => {
    // An exact-match block for the path itself, or a prefix block that covers
    // it — `/api/auth` is served as `location /api/auth/`.
    const covered = nginxFrontendPaths().some((f) => f === p || p.startsWith(`${f}/`))
    expect(covered).toBe(true)
  })

  it('the frontend’s middleware exempts exactly these paths from auth', () => {
    // The middleware matcher is the other copy of this list, and the one that
    // decides whether an unauthenticated request even reaches the route. If it
    // and the file tree disagree, one of them is wrong.
    const mw = readFileSync(path.join(REPO_ROOT, 'apps/frontend/src/middleware.ts'), 'utf8')
    for (const p of served) {
      expect(mw).toContain(p.slice(1)) // 'api/login-challenge', …
    }
  })
})
