import { db } from '@/lib/db/client'
import { users, productTranslations, ciSources, deploymentEnvironments } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

export interface CiSource {
  url: string
  accessToken: string
  provider: 'gitlab' | 'github' | 'bitbucket'
}

export const findProductName = async (productId: number): Promise<string> => {
  const rows = await db
    .select({ name: productTranslations.name })
    .from(productTranslations)
    .where(sql`${productTranslations.productId} = ${productId} AND ${productTranslations.languageCode} = 'en'`)
    .limit(1)
  return rows[0]?.name ?? `Product #${productId}`
}

export const findUserEmail = async (userId: number): Promise<string | null> => {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return rows[0]?.email ?? null
}

export const findUserName = async (userId: number): Promise<string> => {
  const rows = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return rows[0]?.name ?? `User #${userId}`
}

export const findAdminEmails = async (): Promise<string[]> => {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(sql`${users.role} IN ('admin', 'root') AND ${users.active} = true`)
  return rows.map((r) => r.email)
}

export const findCiSourceForEnv = async (environmentId: number): Promise<CiSource | null> => {
  const envRows = await db
    .select({ ciSourceId: deploymentEnvironments.ciSourceId })
    .from(deploymentEnvironments)
    .where(eq(deploymentEnvironments.id, environmentId))
    .limit(1)

  if (!envRows[0]) return null

  const sourceRows = await db
    .select({ url: ciSources.url, accessToken: ciSources.accessToken, provider: ciSources.provider })
    .from(ciSources)
    .where(eq(ciSources.id, envRows[0].ciSourceId))
    .limit(1)

  if (!sourceRows[0]) return null

  return {
    url: sourceRows[0].url,
    accessToken: sourceRows[0].accessToken,
    provider: sourceRows[0].provider as 'gitlab' | 'github' | 'bitbucket',
  }
}
