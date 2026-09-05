import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  infrastructureElements, unclaimedStates, driftReportState, pipelineStacks,
  type DriftSummary,
} from '@/lib/db/schema'
import { logAudit } from '@/lib/audit'

/**
 * Recording what the scheduled drift pipeline found (#108).
 *
 * The portal does not ask. A pipeline in `infra-templates` runs on GitLab's own
 * schedule, walks every Terraform state in the backend, runs
 * `plan -refresh-only -detailed-exitcode` against each, and POSTs one report.
 *
 * That inversion is what makes this small. The push design in #108 needed
 * refresh-specific pipeline tracking (`pipeline_id` is already two-phase-owned
 * by provisioning and teardown), a third match branch in the webhook handler (a
 * refreshing element stays 'active' and matches neither existing predicate),
 * and log scraping to recover `-detailed-exitcode` from a pipeline status that
 * only carries success or failed. None of that exists here because none of it
 * is needed.
 *
 * A report is UNTRUSTED INPUT. It arrives from CI over a shared secret, and the
 * rules below are the whole of what it may do:
 *
 *  - it may never create, delete or decommission an element;
 *  - it may only write the four refresh columns, and only on elements that are
 *    'active' — an element mid-teardown is not something a stale plan should
 *    annotate;
 *  - a state key it does not recognise is recorded as an observation and
 *    nothing else.
 */

/** What a plan concluded about one state file. */
export type RefreshOutcome = 'clean' | 'drifted' | 'locked' | 'error'

export interface StateResult {
  stateKey: string
  outcome: RefreshOutcome
  summary?: DriftSummary
}

export interface DriftReport {
  checkedAt: Date
  results: StateResult[]
}

export interface RecordedReport {
  matched: number
  unclaimed: number
  /** Results naming a state key that belongs to a non-active element. */
  ignored: number
}

/**
 * Apply one result, and say whether an element took it.
 *
 * ONE statement, deliberately. The first version read the claiming elements and
 * then updated them, and the `status = 'active'` guard on the update was
 * unreachable in any test — `claimedKeys` had already filtered them out, so the
 * guard only defended a teardown starting between the read and the write. A
 * predicate nothing can exercise is a predicate nobody can trust; folding the
 * match into the UPDATE makes it the only guard there is, and `returning` says
 * whether it held.
 *
 * The join is on `state_keys`, which is `{ "<stackId>": "<stateKeyName>" }` and
 * was RECORDED at provisioning by #200 rather than recomputed — because an
 * admin editing a stack's `stateKeyParam` moves the key of every element
 * already running under it, and recomputing would address state files that were
 * never created. An element owns one key per stack it fanned out to, so the
 * match is over the values, not the keys.
 */
const applyResult = async (result: StateResult, checkedAt: Date): Promise<number[]> => {
  const drifted = result.outcome === 'drifted'
  const rows = await db
    .update(infrastructureElements)
    .set({
      lastRefreshedAt: checkedAt,
      lastRefreshOutcome: result.outcome,
      // Cleared on a clean report so the column describes CURRENT drift, and
      // left alone on 'locked' or 'error': a plan that could not run has not
      // established that the drift went away.
      ...(drifted
        ? { driftDetectedAt: checkedAt, driftSummary: result.summary ?? { resources: [] } }
        : result.outcome === 'clean'
          ? { driftDetectedAt: null, driftSummary: null }
          : {}),
    })
    .where(
      and(
        // An element on its way out is not something a plan that started before
        // the teardown should annotate.
        eq(infrastructureElements.status, 'active'),
        sql`EXISTS (SELECT 1 FROM jsonb_each_text(${infrastructureElements.stateKeys}) AS kv WHERE kv.value = ${result.stateKey})`,
      ),
    )
    .returning({ id: infrastructureElements.id })

  return rows.map((r) => r.id)
}

export const recordDriftReport = async (report: DriftReport): Promise<RecordedReport> => {
  const matched: { id: number; result: StateResult }[] = []
  const unknown: StateResult[] = []

  for (const result of report.results) {
    const ids = await applyResult(result, report.checkedAt)
    if (ids.length === 0) unknown.push(result)
    else for (const id of ids) matched.push({ id, result })
  }

  for (const result of unknown) {
    await db
      .insert(unclaimedStates)
      .values({
        stateKey: result.stateKey,
        firstSeenAt: report.checkedAt,
        lastSeenAt: report.checkedAt,
        outcome: result.outcome,
        summary: result.summary ?? null,
      })
      .onConflictDoUpdate({
        target: unclaimedStates.stateKey,
        // `first_seen_at` is deliberately not touched: how long a state has been
        // unaccounted for is the useful part of the record.
        set: { lastSeenAt: report.checkedAt, outcome: result.outcome, summary: result.summary ?? null },
      })
  }

  // A state key that has since been claimed — an element adopted or recreated —
  // stops being an observation. Left behind it would report a problem that is
  // no longer one.
  const nowClaimed = matched.map((m) => m.result.stateKey)
  if (nowClaimed.length > 0) {
    await db.delete(unclaimedStates).where(inArray(unclaimedStates.stateKey, nowClaimed))
  }

  await db
    .update(driftReportState)
    .set({
      lastReportAt: report.checkedAt,
      elementsReported: matched.length,
      unclaimedReported: unknown.length,
    })
    .where(eq(driftReportState.id, 1))

  // Only when something actually drifted. A clean run every fifteen minutes
  // would bury the audit log, which is how an audit log stops being read.
  const drifted = matched.filter((m) => m.result.outcome === 'drifted')
  if (drifted.length > 0) {
    await logAudit(
      null,
      'infra.drift_detected',
      drifted[0].id,
      `Drift reported on ${drifted.length} element(s): ` +
        drifted.map((d) => `#${d.id} (${d.result.summary?.resources.length ?? 0} resources)`).join(', '),
    )
  }

  return { matched: matched.length, unclaimed: unknown.length, ignored: 0 }
}

/** How stale the whole picture is, for the admin UI to show. */
export const driftReportStatus = async (): Promise<{
  lastReportAt: Date | null
  elementsReported: number
  unclaimedReported: number
  neverReported: number
}> => {
  const [state] = await db.select().from(driftReportState).where(eq(driftReportState.id, 1))
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(infrastructureElements)
    .where(and(eq(infrastructureElements.status, 'active'), sql`${infrastructureElements.lastRefreshedAt} IS NULL`))

  return {
    lastReportAt: state?.lastReportAt ?? null,
    elementsReported: state?.elementsReported ?? 0,
    unclaimedReported: state?.unclaimedReported ?? 0,
    // Active elements nothing has ever said anything about. Distinct from
    // "reported clean" and the number an operator actually needs.
    neverReported: n,
  }
}

/** One element's worth of work for the reporting pipeline. */
export interface DriftTarget {
  elementId: number
  /** The base state name; each step appends its own `stateSuffix`. */
  stateName: string
  stack: { template: string; stateSuffix: string }[]
  /** What this element was provisioned with, so a plan can run against it. */
  variables: Record<string, string>
}

/**
 * The work list the scheduled pipeline asks for (#108).
 *
 * `plan -refresh-only` needs the template AND the variables the apply used —
 * a state file alone does not say which module produced it or what its inputs
 * were. So the portal has to hand both over, and this is that endpoint's data.
 *
 * It is worth being plain about what that means: CI already receives exactly
 * these variables when the element is provisioned, so this is not a new class
 * of exposure — but it is the whole estate at once rather than one order's
 * worth. Hence: behind the same shared secret as the report itself, ACTIVE
 * elements only, and nothing about an element whose teardown has started.
 *
 * Elements with no recorded `state_keys` are omitted rather than guessed at.
 * Those predate #200, and recomputing the key from today's `stateKeyParam`
 * would address a state file that was never created — the exact bug #200 fixed.
 */
export const driftTargets = async (): Promise<DriftTarget[]> => {
  const elements = await db
    .select({
      id: infrastructureElements.id,
      productId: infrastructureElements.productId,
      environmentId: infrastructureElements.environmentId,
      parameters: infrastructureElements.parameters,
      stateKeys: infrastructureElements.stateKeys,
      stateKeyNamespace: infrastructureElements.stateKeyNamespace,
    })
    .from(infrastructureElements)
    .where(eq(infrastructureElements.status, 'active'))

  const targets: DriftTarget[] = []
  for (const element of elements) {
    const keys = Object.entries(element.stateKeys ?? {})
    if (keys.length === 0) continue

    const stacks = await db
      .select({ id: pipelineStacks.id, steps: pipelineStacks.steps })
      .from(pipelineStacks)
      .where(
        and(
          eq(pipelineStacks.productId, element.productId),
          eq(pipelineStacks.environmentId, element.environmentId),
        ),
      )

    for (const [stackId, stateName] of keys) {
      const stack = stacks.find((s) => String(s.id) === stackId)
      // A stack deleted since the element was provisioned. Its state file still
      // exists, so it will turn up as an unclaimed state — which is the honest
      // outcome, and better than planning it against a guess.
      if (!stack) continue

      targets.push({
        elementId: element.id,
        stateName,
        stack: (stack.steps ?? []).map((step) => ({
          template: step.template,
          stateSuffix: step.stateSuffix,
        })),
        variables: element.parameters ?? {},
      })
    }
  }
  return targets
}
