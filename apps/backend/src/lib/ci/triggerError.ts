/**
 * How a failed pipeline trigger is described to the rest of the system.
 *
 * The message thrown here does not stay inside the CI layer: `ci/webhooks.ts`
 * collects it into `TriggerOutcome.failures`, and the teardown/retry paths in
 * `services/infrastructure.ts` put that list into a 502 response body a project
 * manager can trigger AND into `logAudit`. The request that failed carried the
 * order's parameter values as trigger variables — including the sensitive ones —
 * and providers echo input back on a validation error (GitHub's 422 lists the
 * offending inputs verbatim). Splicing the response body into the message
 * therefore turned a mistyped webhook URL into a secret disclosure with an audit
 * trail (issue #144).
 *
 * So: the body is read and logged where operators can see it, and the message
 * carries only the provider, the operation and the HTTP status — which is what a
 * caller can actually act on anyway.
 */
export const triggerFailure = async (operation: string, res: Response): Promise<Error> => {
  // Never let diagnostics turn into a different failure: a body that cannot be
  // read is not worth losing the status over.
  const body = await res.text().catch(() => '')
  if (body) console.error(`[ci] ${operation} failed with ${res.status}; provider said:`, body)
  return new Error(`${operation} failed: ${res.status}`)
}
