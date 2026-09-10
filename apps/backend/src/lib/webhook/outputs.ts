import { fetchJobTraces, parseTofuOutputs, supportsJobTrace } from '@/lib/ci'
import type { CiSource } from '@/lib/db/queries'

/**
 * Read one element's Terraform outputs out of its pipeline logs (issues #215, #218).
 *
 * Extracted from `settle.ts` so that a person looking at an element can ask for
 * the same read a second time. That matters more than it sounds: outputs are
 * parsed exactly once, when the order settles, and if anything was wrong at that
 * moment — a revoked CI token, a log the parser could not read (#216) — the
 * element is empty forever and the only remedies were a database script or
 * redeploying real infrastructure.
 *
 * Returns the outputs it could read and, when it read none, why. The caller
 * decides what to persist: the settle path and the refresh path want the same
 * answer written the same way, which is the whole reason this is one function.
 */
export interface OutputsRead {
  outputs: Record<string, string>
  /** Null when outputs were read. Otherwise, what to show an operator. */
  error: string | null
}

/** Reasons that belong to the environment rather than to one element. */
export const outputsUnavailableReason = (
  ciSource: CiSource | null,
): string | null => {
  if (!ciSource) {
    return 'This deployment environment has no CI source, so the pipeline log cannot be read and no Terraform outputs can be collected. Set one under Admin → Environments.'
  }
  if (!supportsJobTrace(ciSource.provider)) {
    return `Reading pipeline logs is not implemented for ${ciSource.provider}, so Terraform outputs cannot be collected. Only GitLab supports it today.`
  }
  if (!ciSource.projectRef) {
    // GitLab's job endpoints are project-scoped and the project is only named in
    // the environment's trigger URL, so a URL of another shape means the log
    // cannot be located at all. An operator can fix this, but only if they are
    // told which URL and what is wrong with it — hence the shape in the message.
    return "The environment's trigger URL has no /projects/<id>/ segment, so the pipeline log cannot be located and no Terraform outputs can be collected. Check the webhook URL under Admin → Environments."
  }
  return null
}

export const readOutputsForElement = async (
  ciSource: CiSource,
  pipelineIds: string[],
  context: { elementId: number; orderId?: number },
): Promise<OutputsRead> => {
  if (pipelineIds.length === 0) {
    // A row whose triggers never fired. Its outputs are unknown, and borrowing a
    // sibling's is exactly the confusion the per-element loop ends.
    console.warn(
      `[outputs] Element ${context.elementId}${context.orderId ? ` (order ${context.orderId})` : ''} ` +
        `has no pipeline of its own; no Terraform outputs recorded for it.`,
    )
    return {
      outputs: {},
      error:
        'No pipeline ever started for this element, so there is no log to read Terraform outputs from.',
    }
  }

  const outputs: Record<string, string> = {}
  // Kept so the element can say the log was unreadable rather than empty: a
  // revoked CI token and a template that declares no outputs are the same blank
  // card otherwise, and only one of them is anybody's to fix.
  let readFailure: string | null = null

  for (const pipelineId of pipelineIds) {
    let traces: string[]
    try {
      traces = await fetchJobTraces(ciSource, pipelineId)
    } catch (err) {
      // One unreadable pipeline log must not cost the outputs of the pipelines
      // that did report.
      console.error(
        `[outputs] Could not read the job log of pipeline ${pipelineId} (element ${context.elementId}):`,
        err,
      )
      // The message, not the object: a stack trace is for the log, and the useful
      // half of "GitLab jobs fetch failed: 401" is the 401.
      readFailure = err instanceof Error ? err.message : String(err)
      continue
    }
    for (const trace of traces) {
      for (const [key, value] of Object.entries(parseTofuOutputs(trace))) {
        // First writer wins, iterating this element's pipeline ids in the order
        // they were triggered: two of ITS pipelines both declaring `ip_address`
        // is a naming collision in the templates, and picking by CI timing would
        // make the recorded value change from run to run.
        if (key in outputs) {
          if (outputs[key] !== value) {
            console.warn(
              `[outputs] Element ${context.elementId}: output "${key}" is reported by more ` +
                `than one of its pipelines with different values; keeping the first.`,
            )
          }
          continue
        }
        outputs[key] = value
      }
    }
  }

  if (Object.keys(outputs).length > 0) return { outputs, error: null }

  if (readFailure) {
    return {
      outputs,
      error:
        `The pipeline log could not be read, so Terraform outputs could not be collected: ${readFailure}. ` +
        "This is usually the CI source's access token — check it under Admin → CI Sources; it needs at least read_api scope.",
    }
  }
  return {
    outputs,
    error:
      'The pipeline log was read successfully and contained no Terraform "Outputs:" block, so this deployment declared none.',
  }
}
