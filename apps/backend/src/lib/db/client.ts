import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Next.js dev mode re-executes modules on hot reload, creating a new pool
// each time. Store the client on globalThis to reuse it across reloads.
const g = globalThis as unknown as { __pgClient?: ReturnType<typeof postgres> }
const client = g.__pgClient ?? postgres(process.env.DATABASE_URL ?? '')
if (process.env.NODE_ENV !== 'production') g.__pgClient = client

export const db = drizzle(client, { schema })
export { client }
