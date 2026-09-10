import { defineConfig } from 'drizzle-kit'

// Read rather than asserted: drizzle-kit is run by hand (`db:generate`,
// `db:migrate`), and "connection string undefined" from deep inside the driver is
// a worse way to learn the env var is missing than being told here.
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set — drizzle-kit has no database to talk to')

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
})
