import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listDelegations, createDelegation } from '@/lib/services/delegations'

// Dates arrive as the calendar dates the admin typed (`<input type="date">`), not
// as instants — a delegation covers days, not a span of hours. The service does
// the real validation (a date that does not exist, ordering, no backdating), so
// this only rejects the obviously malformed shape.
const CreateDelegationSchema = z.object({
  toUserId: z.number().int().positive(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function GET(req: NextRequest) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  return toResponse(await listDelegations(session))
}

export async function POST(req: NextRequest) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = CreateDelegationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await createDelegation(session, parsed.data), 201)
}
