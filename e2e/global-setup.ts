import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

function resolveDbUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  // Fall back to backend .env for local dev (not set in playwright's root process)
  try {
    const content = readFileSync('./apps/backend/.env', 'utf-8')
    return content.match(/^DATABASE_URL=(.+)$/m)?.[1]
  } catch {
    return undefined
  }
}

export default async function globalSetup() {
  const databaseUrl = resolveDbUrl()
  if (!databaseUrl) return

  try {
    const url = new URL(databaseUrl)
    const env = { ...process.env, PGPASSWORD: url.password || '' }
    const psqlArgs = ['-h', url.hostname, '-p', url.port || '5432', '-U', url.username]
    const dbName = url.pathname.slice(1)

    // Only create the database if it doesn't exist yet
    const probe = spawnSync('psql', [...psqlArgs, '-d', dbName, '-c', '\\q'], { env, stdio: 'pipe' })
    // `spawnSync`'s error is typed as plain `Error`; the `code` that says psql is
    // not installed lives on the Node `SystemError` shape underneath it. Narrowed
    // rather than asserted, so a future Node that stops setting it reads as
    // "psql is present" instead of throwing on the property access.
    const spawnFailedBecausePsqlIsMissing =
      probe.error !== undefined &&
      'code' in probe.error &&
      (probe.error as NodeJS.ErrnoException).code === 'ENOENT'

    if (probe.status !== 0 && !spawnFailedBecausePsqlIsMissing) {
      spawnSync('psql', [...psqlArgs, '-d', 'postgres', '-c', `CREATE DATABASE "${dbName}"`], { env, stdio: 'pipe' })
    }
  } catch {
    // psql unavailable or URL malformed — backend will fail with a clear error
  }
}
