/**
 * How one infrastructure element's Terraform state is told apart from its
 * siblings' (issue #104).
 *
 * Its own module, not part of `lib/ci/webhooks`, for a practical reason: the
 * services that BUILD trigger variables and the trigger layer that CONSUMES them
 * both need this, and `lib/ci/webhooks` is mocked wholesale in the service tests
 * — importing a constant from a mocked module yields undefined, which is how a
 * variable name silently becomes the string "undefined".
 */

/** CI variable carrying the element's 1-based position within its order. */
export const ELEMENT_SEQUENCE_VAR = 'ELEMENT_SEQUENCE'

/**
 * The suffix that makes one element's state key differ from its siblings'.
 *
 * One order now provisions N elements, and every one of them fans out to the same
 * webhooks and stacks with the same variables — so without this they would all
 * derive the same TF_STATE_NAME and element two would `apply` on top of element
 * one's state. The element's 1-based `sequence` is the only thing that
 * distinguishes them, and it is stored on the row so provisioning, retry and
 * teardown all derive the SAME key for the same element.
 *
 * Element 1 gets no suffix on purpose: that reproduces, byte for byte, the state
 * name every order placed before quantity existed was provisioned with. Those
 * elements are `sequence = 1`, so their teardown still targets the state their
 * `apply` created. Elements 2..N get `-2`, `-3`, … — the same convention the
 * orchestrator already uses for per-step suffixes (`web-01-vm`).
 */
export const elementStateSuffix = (sequence: string | number | undefined): string => {
  const n = typeof sequence === 'number' ? sequence : Number(sequence ?? '1')
  return Number.isFinite(n) && n >= 2 ? `-${n}` : ''
}
