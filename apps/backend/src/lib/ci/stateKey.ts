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
 * CI variable carrying the server-generated namespace of the element's state key.
 *
 * Present exactly when the element was provisioned with the namespaced scheme
 * below; absent for elements provisioned before it existed, which is what keeps
 * their teardown pointed at the state their own apply created. It is stored per
 * element (`infrastructure_elements.state_key_namespace`) rather than recomputed,
 * so the answer cannot change under an element that is already running.
 */
export const STATE_KEY_NAMESPACE_VAR = 'TF_STATE_NAMESPACE'

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

/**
 * Longest customer-supplied part a state key may carry. Terraform state names
 * become object keys in the remote backend, so this is a readability bound rather
 * than a limit anything enforces: the namespace that follows is what makes the
 * key unique, so truncating the readable half costs nothing.
 */
const STATE_KEY_PART_MAX_LENGTH = 64

/**
 * The state key base for an element provisioned with the namespaced scheme
 * (issue #183).
 *
 * A pipeline stack may name a parameter — `stateKeyParam`, default `hostname` —
 * whose VALUE became the whole state key. That value is typed by whoever places
 * the order, and nothing made it unique: user B ordering the same product and
 * typing the hostname user A used got a pipeline pointed at A's Terraform state,
 * so decommissioning B's own element ran destroy against A's infrastructure while
 * every ownership check in the portal passed.
 *
 * The server-generated order id is appended rather than replacing the value: it
 * is what makes the key unique (nothing a customer types can collide with another
 * order's id), while the readable half keeps state files identifiable to whoever
 * has to look at the bucket. The charset is the one `CODE_PATTERN` already
 * enforces for size codes — the value reaches an orchestrator that treats it as a
 * path, and `../` was previously spellable.
 */
export const namespacedStateKeyBase = (raw: string, namespace: string): string => {
  const safe = raw
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    // A leading dot or dash makes a hidden file or reads as a flag, and a base of
    // ".." was the traversal this closes; the namespace still follows either way.
    .replace(/^[.-]+/, '')
    .slice(0, STATE_KEY_PART_MAX_LENGTH)
  return safe === '' ? namespace : `${safe}-${namespace}`
}

/**
 * What one element's Terraform state key is derived FROM, before the per-element
 * suffix is applied.
 *
 * Three cases, and the middle one is why this is not simply the namespaced form:
 *  - the stack's `stateKeyParam` matches no variable → the order id, unchanged
 *    since before any of this, and safe because the server generates it
 *  - it matches, and the element carries no namespace → the raw value, byte for
 *    byte what the element's own apply used. Elements provisioned before #183 are
 *    the only ones in this case, and re-deriving their key differently would point
 *    their teardown at a state that does not exist — a worse failure than the bug
 *  - it matches and the element carries a namespace → the sanitized value plus the
 *    order id, which is the fixed scheme
 */
export const stateKeyBase = (input: {
  param: string | undefined
  orderId: string | undefined
  namespace: string | undefined
}): string => {
  if (input.param === undefined) return input.orderId ?? ''
  if (input.namespace === undefined) return input.param
  return namespacedStateKeyBase(input.param, input.namespace)
}
