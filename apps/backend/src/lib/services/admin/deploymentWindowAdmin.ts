import { db } from '@/lib/db/client'
import { appConfig, deploymentWindows } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ok, err, type Result } from '@/lib/services/result'
import { logAuditWith } from '@/lib/audit'
import { validateWindows, type DeploymentWindow } from '@/lib/services/deploymentWindows'

/**
 * Root configuring when provisioning may run (#330).
 *
 * The feature shipped inert: the tables and the arithmetic existed, an approved
 * order could be put into `scheduled`, and nothing anywhere could define a
 * window or turn an environment on. This is the missing half.
 *
 * Windows are replaced as a SET, never edited one at a time. `validateWindows`
 * refuses overlaps, and an overlap is a property of the collection — a
 * row-at-a-time API would have to either reject a legal rearrangement (moving
 * 08:00 to 13:00 while 13:00 still exists) or accept an illegal intermediate
 * state and hope the caller finishes. Sending the whole set is the only shape
 * where "these are the windows" is a single decision.
 */

export interface WindowSettings {
  timeZone: string
  windows: DeploymentWindow[]
}

/** Minutes past local midnight, as `HH:MM`, for the admin UI to show. */
export const asClock = (startMinute: number): string =>
  `${String(Math.floor(startMinute / 60)).padStart(2, '0')}:${String(startMinute % 60).padStart(2, '0')}`

export const getWindowSettings = async (): Promise<Result<WindowSettings>> => {
  const [config] = await db.select({ zone: appConfig.deploymentTimeZone }).from(appConfig).limit(1)
  const windows = await db
    .select({ startMinute: deploymentWindows.startMinute, durationMinutes: deploymentWindows.durationMinutes })
    .from(deploymentWindows)
    // Read in the order a human wrote them down. The policy does not care —
    // `isWithinWindow` asks every window — but a list that reorders itself
    // between saves reads as the portal having changed something.
    .orderBy(deploymentWindows.startMinute)

  return ok({ timeZone: config?.zone ?? 'UTC', windows })
}

/**
 * Is this a zone the runtime actually knows?
 *
 * Asked before storing rather than at the decision point. An unknown zone makes
 * `Intl.DateTimeFormat` throw, and the throw would surface inside an approval —
 * a caller with no idea why, hours after the typo was saved.
 */
const isKnownTimeZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export const replaceWindowSettings = async (
  input: WindowSettings,
  actorId: number,
): Promise<Result<WindowSettings>> => {
  if (!isKnownTimeZone(input.timeZone)) {
    return err(400, `Unknown time zone "${input.timeZone}". Use an IANA name such as Europe/Berlin.`)
  }

  const invalid = validateWindows(input.windows)
  if (invalid) return err(400, invalid)

  const [before] = await db.select({ zone: appConfig.deploymentTimeZone }).from(appConfig).limit(1)
  const previous = await db
    .select({ startMinute: deploymentWindows.startMinute, durationMinutes: deploymentWindows.durationMinutes })
    .from(deploymentWindows)
    .orderBy(deploymentWindows.startMinute)

  /*
   * One transaction, because the empty moment in between is a live decision
   * point. `whenMayItDeploy` reads the windows on every approval, and a delete
   * that is briefly visible without its replacement means no windows — which
   * this feature deliberately treats as "no restriction, provision now". An
   * admin rearranging the schedule would occasionally let an order straight
   * through the gap they were narrowing.
   */
  await db.transaction(async (tx) => {
    await tx.delete(deploymentWindows)
    if (input.windows.length > 0) {
      await tx.insert(deploymentWindows).values(
        input.windows.map((w) => ({ startMinute: w.startMinute, durationMinutes: w.durationMinutes })),
      )
    }
    await tx.update(appConfig).set({ deploymentTimeZone: input.timeZone }).where(eq(appConfig.id, 1))

    /*
     * Inside the transaction, with the writes it describes.
     *
     * The audit entry is the only record of who narrowed the window that an
     * order then waited for. Written after the commit, a failing insert would
     * leave the new schedule live and unattributed, and the caller would see an
     * error for a change that had in fact taken effect — the worst of both
     * readings. Together they either both happen or neither does.
     */
    await logAuditWith(
      tx,
      actorId,
      'deployment_windows.updated',
      // No entity id: the change is to the window SET, which is not a row.
      undefined,
      describeChange(before?.zone ?? 'UTC', previous, input),
    )
  })

  return getWindowSettings()
}

/**
 * What changed, in the terms root thinks in.
 *
 * A diff of minute integers is unreadable in an audit log, and the audit log is
 * the only record of who narrowed the window that an order then waited for.
 */
const describeChange = (
  beforeZone: string,
  before: DeploymentWindow[],
  after: WindowSettings,
): string => {
  const render = (ws: DeploymentWindow[]) =>
    ws.length === 0
      ? 'none'
      : ws.map((w) => `${asClock(w.startMinute)} for ${w.durationMinutes}m`).join(', ')

  const parts: string[] = []
  if (beforeZone !== after.timeZone) parts.push(`time zone ${beforeZone} → ${after.timeZone}`)
  const from = render(before)
  const to = render(after.windows)
  if (from !== to) parts.push(`windows ${from} → ${to}`)
  return parts.length > 0 ? `Deployment windows: ${parts.join('; ')}` : 'Deployment windows saved unchanged'
}
