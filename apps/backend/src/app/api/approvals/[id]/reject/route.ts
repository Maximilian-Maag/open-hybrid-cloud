import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { db } from '@/lib/db/client'
import { orders, users, productTranslations } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import { sendOrderRejected } from '@/lib/notification'

const RejectSchema = z.object({
  rejectionNote: z.string().min(1),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const { id } = await params
  const orderId = parseInt(id, 10)

  const body = await req.json().catch(() => null)
  const parsed = RejectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { rejectionNote } = parsed.data

  const orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)

  if (!orderRows.length) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const order = orderRows[0]

  if (order.status !== 'pending') {
    return NextResponse.json({ error: 'Order is not pending' }, { status: 400 })
  }

  await db
    .update(orders)
    .set({ status: 'rejected', rejectionNote, updatedAt: new Date() })
    .where(eq(orders.id, orderId))

  await logAudit(session.id, 'order.rejected', order.id, `Rejected: ${rejectionNote}`)

  // Notify orderer
  const userRows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, order.userId))
    .limit(1)

  const productNameRows = await db
    .select({ name: productTranslations.name })
    .from(productTranslations)
    .where(
      sql`${productTranslations.productId} = ${order.productId} AND ${productTranslations.languageCode} = 'en'`,
    )
    .limit(1)

  const productName = productNameRows[0]?.name ?? `Product #${order.productId}`
  if (userRows[0]?.email) {
    await sendOrderRejected(userRows[0].email, productName, order.id, rejectionNote)
  }

  return NextResponse.json({ success: true })
}
