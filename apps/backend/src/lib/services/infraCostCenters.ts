import { db } from '@/lib/db/client'
import { orders, projects, costCenters } from '@/lib/db/schema'
import { eq, inArray, sql } from 'drizzle-orm'

/**
 * Resolve the cost centre label for each of the given orders, keyed by order id.
 *
 * Infrastructure elements carry no cost centre of their own — attribution is
 * decided when the order is placed (see validateCostCenter) and stored on
 * `orders`. One batched query rather than a join inside listInfrastructure,
 * because only the export needs this column and every list render would
 * otherwise pay for it.
 *
 * `COALESCE(orders.cost_center_id, projects.cost_center_id)`, the same
 * fall-through the detail page, the cost report and the cost export all apply.
 * `cost_center_mode` DEFAULTS to 'project', and in that mode the order
 * deliberately stores null because attribution follows the project — so joining
 * on the order column alone left this cell blank for most of the inventory while
 * the cost dashboard for the same period attributed all of it, and the export is
 * the one that reads as the inventory of record (issue #189).
 */
export const getCostCentersForInfra = async (
  orderIds: number[],
): Promise<Map<number, string>> => {
  const unique = [...new Set(orderIds)]
  if (unique.length === 0) return new Map()

  const rows = await db
    .select({
      orderId: orders.id,
      code: costCenters.code,
      name: costCenters.name,
    })
    .from(orders)
    .leftJoin(projects, eq(orders.projectId, projects.id))
    .leftJoin(
      costCenters,
      eq(sql`COALESCE(${orders.costCenterId}, ${projects.costCenterId})`, costCenters.id),
    )
    .where(inArray(orders.id, unique))

  const byOrder = new Map<number, string>()
  for (const row of rows) {
    // Only an order whose project has none either is genuinely unattributed;
    // leave that cell empty rather than inventing a label for it.
    if (row.code) byOrder.set(row.orderId, `${row.code} — ${row.name}`)
  }
  return byOrder
}
