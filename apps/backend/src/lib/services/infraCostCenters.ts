import { db } from '@/lib/db/client'
import { orders, costCenters } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'

/**
 * Resolve the cost centre label for each of the given orders, keyed by order id.
 *
 * Infrastructure elements carry no cost centre of their own — attribution is
 * decided when the order is placed (see validateCostCenter) and stored on
 * `orders`. One batched query rather than a join inside listInfrastructure,
 * because only the export needs this column and every list render would
 * otherwise pay for it.
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
    .leftJoin(costCenters, eq(orders.costCenterId, costCenters.id))
    .where(inArray(orders.id, unique))

  const byOrder = new Map<number, string>()
  for (const row of rows) {
    // An order in 'project' cost-centre mode has none of its own; leave the cell
    // empty rather than inventing a label for it.
    if (row.code) byOrder.set(row.orderId, `${row.code} — ${row.name}`)
  }
  return byOrder
}
