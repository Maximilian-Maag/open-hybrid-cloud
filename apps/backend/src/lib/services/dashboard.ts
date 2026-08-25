import { db } from '@/lib/db/client'
import {
  orders,
  infrastructureElements,
  projects,
  deploymentEnvironments,
} from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { ok, type Result } from '@/lib/services/result'
import type { SessionUser, OrderStatus } from '@open-hybrid-cloud/types'

/**
 * Everything the landing page renders, and nothing else.
 *
 * The dashboard used to answer four questions — how many orders, how many are
 * pending, how many elements are active, how many projects — by downloading
 * `GET /api/orders`, `GET /api/infrastructure` and `GET /api/projects` in full
 * and calling `.length` and `.filter().length` on the results. For an
 * administrator that is every order ever placed and every element ever
 * provisioned, on the page every user lands on immediately after login.
 *
 * The row shape is what makes it worse than the row count suggests: `listOrders`
 * selects `parameters` and `productSnapshot`, both jsonb, and a snapshot with
 * ten parameters is roughly 1.5 KB. At 50,000 orders that is an ~80 MB JSON
 * array, built whole in Node by `NextResponse.json` with no streaming and parsed
 * whole again in the frontend server — which OOMs the container before it
 * answers (#158).
 *
 * Five bounded queries instead: four counts and the five most recent orders.
 * The response is a fixed size regardless of how much history exists.
 *
 * The catalogue was already fixed this way (#91). The lesson was applied there
 * and nowhere else.
 */

/** One row of the "recent orders" list, with only the columns it renders. */
export interface DashboardOrder {
  id: number
  productId: number
  productName: string | null
  environmentName: string | null
  projectName: string | null
  status: OrderStatus
  createdAt: Date
}

export interface DashboardSummary {
  orders: { total: number; pending: number }
  infrastructure: { active: number }
  projects: { total: number }
  /** Newest first. Capped at RECENT_ORDERS — the page renders five. */
  recentOrders: DashboardOrder[]
}

/**
 * How many recent orders to return.
 *
 * The page slices to five. Returning exactly five rather than "a page" is the
 * point: this endpoint answers one screen's question, and anything more is the
 * unbounded read it exists to remove.
 */
const RECENT_ORDERS = 5

const countOf = async (query: PromiseLike<{ n: number }[]>): Promise<number> =>
  (await query)[0]?.n ?? 0

export const getDashboardSummary = async (
  session: SessionUser,
  lang = 'en',
): Promise<Result<DashboardSummary>> => {
  const isAdmin = session.role === 'admin' || session.role === 'root'

  // Scoped exactly as the three list endpoints it replaces are, so the numbers
  // agree with the pages they link to. Orders and projects scope by owner;
  // infrastructure scopes through the element's project, which is what
  // `listInfrastructure` does — an element has no user of its own.
  const ownOrders = isAdmin ? undefined : eq(orders.userId, session.id)
  const ownProjects = isAdmin ? undefined : eq(projects.ownerId, session.id)

  const [totalOrders, pendingOrders, activeInfra, totalProjects, recentOrders] =
    await Promise.all([
      countOf(
        db.select({ n: sql<number>`COUNT(*)::int` }).from(orders).where(ownOrders),
      ),
      countOf(
        db
          .select({ n: sql<number>`COUNT(*)::int` })
          .from(orders)
          .where(and(eq(orders.status, 'pending'), ownOrders)),
      ),
      countOf(
        db
          .select({ n: sql<number>`COUNT(*)::int` })
          .from(infrastructureElements)
          .leftJoin(projects, eq(infrastructureElements.projectId, projects.id))
          .where(
            and(
              eq(infrastructureElements.status, 'active'),
              isAdmin ? undefined : eq(projects.ownerId, session.id),
            ),
          ),
      ),
      countOf(
        db.select({ n: sql<number>`COUNT(*)::int` }).from(projects).where(ownProjects),
      ),
      db
        .select({
          id: orders.id,
          productId: orders.productId,
          productName: sql<string>`(
            SELECT name FROM product_translations
            WHERE product_id = ${orders.productId} AND language_code = ${lang}
            LIMIT 1
          )`,
          environmentName: deploymentEnvironments.name,
          projectName: projects.name,
          status: orders.status,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .leftJoin(deploymentEnvironments, eq(orders.environmentId, deploymentEnvironments.id))
        .leftJoin(projects, eq(orders.projectId, projects.id))
        .where(ownOrders)
        .orderBy(sql`${orders.createdAt} DESC`)
        .limit(RECENT_ORDERS),
    ])

  return ok({
    orders: { total: totalOrders, pending: pendingOrders },
    infrastructure: { active: activeInfra },
    projects: { total: totalProjects },
    recentOrders: recentOrders as DashboardOrder[],
  })
}
