/**
 * Where the pinned `opa` binary comes from, locally and in CI.
 *
 * Pinned by version *and* checksum, for the same reason rule 6 pins Actions to a
 * commit: a gate that fetches whatever the download endpoint currently serves is
 * one supply-chain incident away from evaluating someone else's policy. The
 * checksums are the ones published alongside each release.
 *
 * `make policy-install-opa` runs this file; `scripts/policy-check.ts` calls
 * `resolveOpa()` and refuses to render a verdict without it.
 */
import { spawnSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

export const OPA_VERSION = 'v1.9.0'

/** node platform-arch -> the release asset name and its published SHA-256. */
const ASSETS: Record<string, { asset: string; sha256: string }> = {
  'linux-x64': {
    asset: 'opa_linux_amd64_static',
    sha256: '66fa66f3b730b2fb086003863428b382b2898d343adb4b5dfab5598b4d739eed',
  },
  'linux-arm64': {
    asset: 'opa_linux_arm64_static',
    sha256: 'e7fdc5f823d5156cd449d6242b97b237cacbcbe4f531743d695c8d413d9aebb3',
  },
  'darwin-x64': {
    asset: 'opa_darwin_amd64',
    sha256: '1122d0176604cd055d8f88b2b4d4019c469891d37e0bce9c1306e001e656ad2e',
  },
  'darwin-arm64': {
    asset: 'opa_darwin_arm64_static',
    sha256: '0134337a52bd255a2202eac4b4b85348fd4a77f94e8dab8ebcb2399ec018f4c0',
  },
}

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

/** Gitignored, so a working copy carries the binary without committing 50 MB. */
export const LOCAL_OPA = path.join(REPO_ROOT, '.opa', 'opa')

const isPinnedVersion = (bin: string): boolean => {
  const r = spawnSync(bin, ['version'], { encoding: 'utf8' })
  return r.status === 0 && (r.stdout ?? '').includes(`Version: ${OPA_VERSION.slice(1)}`)
}

/**
 * The pinned opa, or null.
 *
 * An opa already on PATH is used only if it is the pinned version — a policy
 * evaluated by a different Rego version is a different policy, and the whole
 * point of `make policy` is that it answers what CI will answer.
 */
export function resolveOpa(): string | null {
  const candidates = [process.env.OPA, LOCAL_OPA, 'opa'].filter((c): c is string => Boolean(c))
  for (const candidate of candidates) {
    if (candidate !== 'opa' && !fs.existsSync(candidate)) continue
    if (isPinnedVersion(candidate)) return candidate
  }
  return null
}

async function install(): Promise<void> {
  const key = `${process.platform}-${process.arch}`
  const target = ASSETS[key]
  if (!target) {
    throw new Error(`No pinned opa ${OPA_VERSION} build for ${key}. Install it by hand and set OPA=<path>.`)
  }

  const url = `https://openpolicyagent.org/downloads/${OPA_VERSION}/${target.asset}`
  process.stderr.write(`Fetching ${url}\n`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  const body = Buffer.from(await response.arrayBuffer())

  const actual = crypto.createHash('sha256').update(body).digest('hex')
  if (actual !== target.sha256) {
    throw new Error(`Checksum mismatch for ${target.asset}: expected ${target.sha256}, got ${actual}`)
  }

  fs.mkdirSync(path.dirname(LOCAL_OPA), { recursive: true })
  fs.writeFileSync(LOCAL_OPA, body, { mode: 0o755 })
  process.stderr.write(`Installed opa ${OPA_VERSION} at ${LOCAL_OPA}\n`)
}

// Not a top-level await: the repository has no `"type": "module"`, so tsx
// transpiles this to CommonJS and one would not compile.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  if (resolveOpa()) process.stderr.write(`opa ${OPA_VERSION} is already available.\n`)
  else {
    install().catch((e: unknown) => {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
      process.exit(1)
    })
  }
}
