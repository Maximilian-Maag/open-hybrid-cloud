import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, isAuth } from '@/lib/auth/middleware'
import { toResponse } from '@/lib/http'
import { getWindowSettings, replaceWindowSettings } from '@/lib/services/admin/deploymentWindowAdmin'

/**
 * When provisioning may run (#330). Root only, both verbs.
 *
 * Reading is root-only as well as writing, which is stricter than most admin
 * routes here. The windows are a statement about when the company is watching
 * its own infrastructure, and #330 makes them the thing an approved order waits
 * on — that is operational detail, not catalogue data.
 */

const WindowSchema = z.object({
  // Minutes past local midnight. The bounds are the same ones
  // `validateWindows` and the table's check constraint enforce; repeated here
  // so a malformed body is a 400 with a field path rather than a service error.
  startMinute: z.number().int().min(0).max(1439),
  durationMinutes: z.number().int().min(1).max(1440),
})

const SettingsSchema = z.object({
  // Validated as a real zone by the service, which asks Intl rather than
  // matching a pattern: "Europe/Berlin" and "Mars/Olympus" are the same shape.
  timeZone: z.string().min(1).max(64),
  // Capped because this replaces the set wholesale and a window is a minute at
  // minimum; nobody schedules a hundred of them, and the body is parsed into
  // memory before anything else happens.
  windows: z.array(WindowSchema).max(48),
})

export async function GET(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  return toResponse(await getWindowSettings())
}

export async function PUT(req: NextRequest) {
  const session = await requireRole('root')(req)
  if (!isAuth(session)) return session

  const body = await req.json().catch(() => null)
  const parsed = SettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  return toResponse(await replaceWindowSettings(parsed.data, session.id))
}
