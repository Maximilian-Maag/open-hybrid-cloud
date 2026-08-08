import { describe, it, expect } from 'vitest'
import { generatePipelineYaml, type StepInput } from './pipelineStackPreview'

const steps: StepInput[] = [
  { template: 'linode/virtual-machine', stateSuffix: '-vm', execOrder: 0 },
  { template: 'linode/virtual-machine', stateSuffix: '-vm2', execOrder: 0 },
  {
    template: 'linode/firewall',
    stateSuffix: '-fw',
    execOrder: 1,
    upstreamRefs: [{ varName: 'VM_STATE_NAME', suffix: '-vm' }],
    fixedParams: 'REGION=eu-central',
  },
]

describe('generatePipelineYaml', () => {
  it('emits one stage per unique execOrder', () => {
    const yaml = generatePipelineYaml(steps, 'hostname', 'apply')
    expect(yaml).toContain('stages:\n  - order-0\n  - order-1')
  })

  it('reverses stage order for destroy', () => {
    const yaml = generatePipelineYaml(steps, 'hostname', 'destroy')
    expect(yaml).toContain('stages:\n  - order-1\n  - order-0')
  })

  it('renders upstreamRefs as CI variables', () => {
    const yaml = generatePipelineYaml(steps, 'hostname', 'apply')
    expect(yaml).toContain('VM_STATE_NAME: <hostname>-vm')
  })

  it('renders fixedParams as CI variables', () => {
    const yaml = generatePipelineYaml(steps, 'hostname', 'apply')
    expect(yaml).toContain('REGION: eu-central')
  })

  it('groups sibling steps under the same stage', () => {
    const yaml = generatePipelineYaml(steps, 'hostname', 'apply')
    // Two step-linode-virtual-machine-* jobs should both target order-0
    const order0Lines = yaml.split('\n').filter((l) => l.trim() === 'stage: order-0')
    expect(order0Lines).toHaveLength(2)
  })

  it('returns a friendly placeholder when no steps', () => {
    expect(generatePipelineYaml([], 'hostname', 'apply')).toBe('# no steps defined')
  })

  it('substitutes stateKeyParam name in angle brackets', () => {
    const yaml = generatePipelineYaml(steps, 'vm_name', 'apply')
    expect(yaml).toContain('TF_STATE_NAME: <vm_name>-vm')
  })
})
