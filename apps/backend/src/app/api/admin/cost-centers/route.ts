import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { listCostCenters, createCostCenter } from '@/lib/services/admin/costCenters'

const CreateCostCenterSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  active: z.boolean().default(true),
})

export async function GET(req: NextRequest) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  return toResponse(await listCostCenters())
}

export async function POST(req: NextRequest) {
  const session = await requireRole('admin')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = CreateCostCenterSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await createCostCenter(parsed.data), 201)
}
