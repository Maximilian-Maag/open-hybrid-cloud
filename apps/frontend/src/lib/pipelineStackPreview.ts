// TypeScript port of infra-templates/.ci/generate_stack.py. Used to render a
// live preview of the child pipeline that GitLab will generate when the
// orchestrator template runs. Must stay in sync with generate_stack.py.

export interface UpstreamRefInput {
  varName: string
  suffix: string
}

export interface StepInput {
  template: string
  stateSuffix: string
  execOrder?: string | number
  upstreamRefs?: UpstreamRefInput[]
  fixedParams?: string // KEY=value newline-separated (form format)
}

const parseFixedParams = (raw: string | undefined): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!raw) return out
  for (const line of raw.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}

const jobName = (step: StepInput): string => {
  const slug = step.template.replace(/\//g, '-')
  const suffix = step.stateSuffix.replace(/^-+/, '') || 'idx'
  return `step-${slug}-${suffix}`
}

export const generatePipelineYaml = (
  steps: StepInput[],
  stateKeyParam: string,
  tfAction: 'apply' | 'destroy',
): string => {
  if (steps.length === 0) return '# no steps defined'

  // TF_STATE_NAME is a parameter substituted at order time; the preview uses
  // the parameter name in <angle brackets> so users see how it composes.
  const base = `<${stateKeyParam}>`

  const groups = new Map<number, StepInput[]>()
  for (const step of steps) {
    const order = Number(step.execOrder ?? 0) || 0
    const bucket = groups.get(order) ?? []
    bucket.push(step)
    groups.set(order, bucket)
  }
  const orderKeys = [...groups.keys()].sort((a, b) => (tfAction === 'destroy' ? b - a : a - b))

  const lines: string[] = ['stages:']
  for (const order of orderKeys) lines.push(`  - order-${order}`)
  lines.push('')

  for (const order of orderKeys) {
    for (const step of groups.get(order) ?? []) {
      const templateDir = `templates/${step.template}`
      const child = `${templateDir}/.gitlab-ci.yml`
      const stateName = `${base}-${step.stateSuffix.replace(/^-+/, '')}`
      lines.push(`${jobName(step)}:`)
      lines.push(`  stage: order-${order}`)
      lines.push('  trigger:')
      lines.push('    include:')
      lines.push(`      - local: ${child}`)
      lines.push('    strategy: depend')
      lines.push('  variables:')
      lines.push(`    TEMPLATE_DIR: ${templateDir}`)
      lines.push(`    TF_STATE_NAME: ${stateName}`)
      lines.push(`    TF_ACTION: ${tfAction}`)
      for (const ref of step.upstreamRefs ?? []) {
        const varName = ref.varName.trim()
        const suffix = ref.suffix.trim().replace(/^-+/, '')
        if (varName && suffix) lines.push(`    ${varName}: ${base}-${suffix}`)
      }
      const fixed = parseFixedParams(step.fixedParams)
      for (const [k, v] of Object.entries(fixed)) lines.push(`    ${k}: ${v}`)
      lines.push('')
    }
  }

  return lines.join('\n')
}
