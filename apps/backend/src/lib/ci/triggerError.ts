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
/** How much of a provider body is worth keeping in the log. */
const MAX_LOGGED_BODY = 2048

export const triggerFailure = async (operation: string, res: Response): Promise<Error> => {
  // Never let diagnostics turn into a different failure: a body that cannot be
  // read is not worth losing the status over.
  const body = await res.text().catch(() => '')
  if (body) {
    // Truncated: the body is diagnostics, and an untruncated one is both a
    // log-volume problem and a bigger blast radius for the echoed-input case
    // above. 2 KB is enough to see a provider's error envelope; anything past
    // that is a page of HTML or a repeated payload, not a new fact.
    const shown = body.length > MAX_LOGGED_BODY ? `${body.slice(0, MAX_LOGGED_BODY)}… [${body.length} bytes, truncated]` : body
    console.error(`[ci] ${operation} failed with ${res.status}; provider said:`, shown)
  }
  return new Error(`${operation} failed: ${res.status}`)
}
