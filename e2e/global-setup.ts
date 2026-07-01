import { spawnSync } from 'node:child_process'

export default async function globalSetup() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return

  const url = new URL(databaseUrl)
  const dbName = url.pathname.slice(1)

  spawnSync(
    'psql',
    ['-h', url.hostname, '-p', url.port || '5432', '-U', url.username, '-d', 'postgres', '-c', `CREATE DATABASE "${dbName}"`],
    { env: { ...process.env, PGPASSWORD: url.password || '' }, stdio: 'pipe' },
  )
}
