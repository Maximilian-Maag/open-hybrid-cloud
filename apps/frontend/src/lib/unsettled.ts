/**
 * Whether a set of statuses has anything left to wait for.
 *
 * One definition, because "unfinished" is a property of the domain and not of
 * whichever page is asking. `pending` and `provisioning` are an order on its way
 * somewhere; `decommissioning` is an element on its way out. Everything else —
 * completed, failed, rejected, active, decommissioned — stays where it is until
 * a person does something, and a person doing something already refreshes the
 * page.
 *
 * Here rather than beside `AutoRefresh`, and not as a matter of taste. That file
 * carries `'use client'`, and a server component calling into it does not fail
 * at build time — it renders the error boundary at runtime with "Attempted to
 * call hasUnsettled() from the server but hasUnsettled is on the client". Every
 * caller of this is a server component; the component that consumes the answer
 * is the only client in the pair.
 */
const UNSETTLED = new Set(['pending', 'provisioning', 'decommissioning'])

export const hasUnsettled = (statuses: readonly (string | null | undefined)[]): boolean =>
  statuses.some((s) => s !== null && s !== undefined && UNSETTLED.has(s))
