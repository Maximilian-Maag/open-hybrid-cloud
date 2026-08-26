import { db } from '@/lib/db/client'
import { orders, costCenters, projects } from '@/lib/db/schema'
import { eq, inArray, sql } from 'drizzle-orm'

/**
 * Resolve the cost centre label for each of the given orders, keyed by order id.
 *
 * Infrastructure elements carry no cost centre of their own — attribution is
 * decided when the order is placed (see validateCostCenter). One batched query
 * rather than a join inside listInfrastructure, because only the export needs
 * this column and every list render would otherwise pay for it.
 *
 * Attribution falls through from the order to its project, and it has to:
 * `cost_center_mode` DEFAULTS to 'project', and in that mode `validateCostCenter`
 * deliberately stores NULL on the order because the project is what the spend
 * belongs to. Reading only `orders.cost_center_id` therefore leaves the column
 * blank for the MAJORITY of elements — while the element's own detail page and
 * both cost reports resolve the same fall-through and show one.
 *
 * That disagreement is the bug this fixes (#189). An operator exporting the
 * inventory to reconcile chargeback got blank cost centres from the export and a
 * full attribution from the dashboard for the same period, with the export
 * looking like the inventory of record.
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
    // The same COALESCE getInfrastructureElement uses, for the same reason.
    .leftJoin(
      costCenters,
      eq(sql`COALESCE(${orders.costCenterId}, ${projects.costCenterId})`, costCenters.id),
    )
    .where(inArray(orders.id, unique))

  const byOrder = new Map<number, string>()
  for (const row of rows) {
    // Empty only when neither the order nor its project has one, which is a real
    // state rather than a default.
    if (row.code) byOrder.set(row.orderId, `${row.code} — ${row.name}`)
  }
  return byOrder
}
