/**
 * Where the pinned `opa` binary comes from, locally and in CI.
 *
 * Pinned by checksum, for the same reason rule 6 pins Actions to a commit: a gate
 * that runs whatever the download endpoint served, or whatever is on PATH, is one
 * supply-chain incident away from evaluating someone else's policy. The checksums
 * are the ones published alongside each release.
 *
 * The pin is enforced twice, and both times against the bytes rather than against
 * `opa version`: on download, and again on every `make policy` for whichever
 * binary is about to be executed. The second is the one that matters — a version
 * string is something a replacement program can simply print.
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

/** The release asset for the machine this is running on, if there is one. */
export const pinnedAsset = (): { asset: string; sha256: string } | undefined =>
  ASSETS[`${process.platform}-${process.arch}`]

const sha256Of = (file: string): string | null => {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  } catch {
    // Unreadable is indistinguishable from absent for this purpose: the next
    // candidate is tried and the caller is told nothing was found.
    return null
  }
}

/** Where `opa` on PATH actually is, so it can be hashed like any other file. */
const onPath = (): string | null => {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['opa'], { encoding: 'utf8' })
  const first = (r.stdout ?? '').split('\n')[0].trim()
  return r.status === 0 && first !== '' ? first : null
}

/**
 * The pinned opa, or null.
 *
 * Checked by SHA-256 and not by `opa version`, because the version string is
 * output rather than identity: an `.opa/opa`, an `OPA=` override or a PATH binary
 * can be replaced with different code that still prints `Version: 1.9.0`, and the
 * gate would then evaluate this repository's policies with somebody else's
 * program while the README claims a checksum pin. Hashing the file that is about
 * to be executed is the only check that makes that claim true.
 *
 * The consequence is deliberate: an opa 1.9.0 from a distribution package or
 * built from source is *not* accepted, because it is not the artefact the pin
 * names. `make policy-install-opa` fetches the one that is.
 */
export function resolveOpa(): string | null {
  const target = pinnedAsset()
  if (!target) return null
  const candidates = [process.env.OPA, LOCAL_OPA, onPath()].filter((c): c is string => Boolean(c))
  for (const candidate of candidates) {
    if (sha256Of(candidate) === target.sha256) return candidate
  }
  return null
}

async function install(): Promise<void> {
  const key = `${process.platform}-${process.arch}`
  const target = pinnedAsset()
  if (!target) {
    throw new Error(
      `No pinned opa ${OPA_VERSION} build for ${key}. The gate has no checksum to verify against on ` +
        `this platform, so it cannot run here; add the asset and its published SHA-256 to scripts/opa.ts.`,
    )
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
