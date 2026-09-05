import { ELEMENT_SEQUENCE_VAR, STATE_KEY_NAMESPACE_VAR } from './stateKey'

/**
 * The CI trigger variables the server decides, and which a catalogue parameter
 * may therefore never be named after (issue #183).
 *
 * Its own module for the reason `lib/ci/stateKey` is: the admin service that
 * validates parameter NAMES and the services that build trigger VARIABLES both
 * need it, and `lib/ci/webhooks` is mocked wholesale in the service tests.
 *
 * This is a security boundary, not a naming convention. `triggerGitLabPipeline`
 * passes `variables['REF']` as the git ref the pipeline runs on, and the
 * orchestrator reads TF_ACTION to choose apply from destroy — so a parameter
 * DEFINITION carrying either name handed the ordering user a decision the server
 * is supposed to own: arbitrary ref execution with the environment's trigger
 * token, or a provisioning order that destroys instead. `validateAndApply-
 * Parameters` drops submitted keys that have no definition, which stops a
 * hand-written POST but says nothing about a definition that exists — and
 * `sync-parameters` creates definitions from a Terraform file, so no one has to
 * type the name for one to appear.
 */
const RESERVED_CI_VARIABLES: ReadonlySet<string> = new Set([
  // Which git ref/workflow the pipeline runs — the trigger layer reads these
  // before it copies anything else into the request (lib/ci/gitlab.ts,
  // lib/ci/index.ts). Whoever sets them chooses the code that runs.
  'REF',
  'BRANCH',
  'WORKFLOW',
  // What the run does and to which Terraform state.
  'TF_ACTION',
  'TF_STATE_NAME',
  STATE_KEY_NAMESPACE_VAR,
  // Which orchestrator template and step list execute.
  'TEMPLATE',
  'PIPELINE_STACK',
  // Server-generated identity. Overwriting these misattributes a run, and
  // ORDER_ID and ELEMENT_SEQUENCE both feed the state key.
  'ORDER_ID',
  ELEMENT_SEQUENCE_VAR,
  'INFRA_ID',
  // Whether the run is a time-boxed trial. Duplicated from lib/services/trial so
  // this module stays free of the db-backed service layer; reserved.test.ts
  // asserts the two agree.
  'TRIAL',
  'TRIAL_DURATION_MINUTES',
])

// SIZE is deliberately NOT here, though the server sets it. It decides neither
// what code runs nor which state it runs against, the trigger tail already
// overrides it for an offering that HAS sizes, and it is an ordinary enough name
// that products offered without sizes use it as a plain parameter. Reserving it
// would take that away to close nothing.

/**
 * Matched case-insensitively, which is stricter than today's exploit needs: the
 * variable map is keyed exactly, so a parameter named `ref` never reaches
 * `variables['REF']`. It is the import path that makes the loose match worth its
 * cost — `sync-parameters` turns Terraform variables into parameters, Terraform
 * variables are lowercase by convention, and a template that grew an upper-casing
 * step anywhere between the portal and the runner would re-open the hole silently.
 * The price is that a lowercase `template` or `ref` in a template's variables.tf
 * is refused a parameter; both name a value the server already supplies.
 */
export const isReservedCiVariable = (name: string): boolean =>
  RESERVED_CI_VARIABLES.has(name.trim().toUpperCase())

/**
 * The customer-supplied half of a trigger variable map, with every server-owned
 * name removed.
 *
 * Used at every point where stored parameters are spread into trigger variables,
 * because rejecting new definitions cannot help the rows that already exist:
 * a deployment may hold a parameter named REF, and every order placed against it
 * persisted that value into `orders.parameters` and `infrastructure_elements
 * .parameters`. Those rows still provision (on approval), retry and destroy.
 */
export const withoutReservedCiVariables = (
  parameters: Record<string, string>,
): Record<string, string> =>
  Object.fromEntries(Object.entries(parameters).filter(([name]) => !isReservedCiVariable(name)))
