import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The runtime image has to contain the files the app serves (#360).
 *
 * Next.js standalone output deliberately excludes `public/`, so anything in it
 * must be copied by hand in the Dockerfile. It was not, and the whole directory
 * was absent from the deployed image: `/sw.js` returned 404, the service worker
 * never registered, the Progressive Web App from #148 did not exist in any
 * deployed environment — and, because a failed registration makes
 * `navigator.serviceWorker.ready` hang for ever, it took the sign-out button
 * with it (#359).
 *
 * Nothing could see it. It works in `next dev`, which serves `public/` from the
 * source tree, and no test builds the image. This is the cheapest thing that
 * fails when the copy goes missing again.
 */
const FRONTEND = join(import.meta.dirname, '../..')
const dockerfile = readFileSync(join(FRONTEND, 'Dockerfile'), 'utf8')
const publicDir = join(FRONTEND, 'public')

describe('the frontend Dockerfile', () => {
  it('copies public/ into the runtime image', () => {
    const copiesPublic = dockerfile
      .split('\n')
      .some((line) => /^COPY\b/.test(line.trim()) && /\/public\b/.test(line))

    expect(
      copiesPublic,
      'standalone output does not include public/. Without an explicit COPY every file in it ' +
        '404s in production while working perfectly in `next dev` — see #360.',
    ).toBe(true)
  })

  /*
   * The destination matters as much as the copy. `server.js` does
   * `process.chdir(__dirname)` at startup, so assets have to land on the nested
   * monorepo path — copying them to the image root would satisfy the test above
   * and still 404.
   */
  it('copies it to the path server.js chdirs into', () => {
    expect(dockerfile).toMatch(/COPY[^\n]*\/public\s+\.\/apps\/frontend\/public/)
  })

  it('has something in public/ worth copying', () => {
    // If this ever empties out, the rule above is guarding nothing and should
    // be reconsidered rather than left as decoration.
    expect(existsSync(publicDir) && readdirSync(publicDir).length).toBeTruthy()
  })

  // The one that broke. Named explicitly because it is not just any asset: the
  // worker's absence hangs sign-out, so this file being served is load-bearing.
  it('ships the service worker', () => {
    expect(readdirSync(publicDir)).toContain('sw.js')
  })
})
