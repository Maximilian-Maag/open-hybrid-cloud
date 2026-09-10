import { describe, it, expect } from 'vitest'
import {
  isReservedCiVariable,
  isPipelineSuppliedVariable,
  withoutReservedCiVariables,
} from './reserved'
import { ELEMENT_SEQUENCE_VAR, STATE_KEY_NAMESPACE_VAR } from './stateKey'
import { TRIAL_VAR, TRIAL_DURATION_VAR } from '@/lib/services/trial'

describe('isReservedCiVariable', () => {
  it('covers the variables that decide what the pipeline runs and does', () => {
    // The two named in issue #183: `ref` is what GitLab's trigger endpoint runs
    // the pipeline on, TF_ACTION is apply versus destroy.
    expect(isReservedCiVariable('REF')).toBe(true)
    expect(isReservedCiVariable('TF_ACTION')).toBe(true)
    expect(isReservedCiVariable('TF_STATE_NAME')).toBe(true)
    // The same choice on the other two providers, which read BRANCH and WORKFLOW.
    expect(isReservedCiVariable('BRANCH')).toBe(true)
    expect(isReservedCiVariable('WORKFLOW')).toBe(true)
  })

  it('covers the trial variables the services actually emit', () => {
    // reserved.ts spells these out rather than importing them, to stay clear of
    // the db-backed service layer. This is the assertion that keeps the two in
    // step.
    expect(isReservedCiVariable(TRIAL_VAR)).toBe(true)
    expect(isReservedCiVariable(TRIAL_DURATION_VAR)).toBe(true)
    expect(isReservedCiVariable(ELEMENT_SEQUENCE_VAR)).toBe(true)
    expect(isReservedCiVariable(STATE_KEY_NAMESPACE_VAR)).toBe(true)
  })

  it('covers the credentials the OpenTofu state API authenticates with', () => {
    // Same class of decision as TF_STATE_NAME: that one picks WHICH state, these
    // pick WHOSE. A trigger variable overrides a project CI/CD variable in
    // GitLab, so a parameter under either name replaces the operator's token
    // with one the orderer chose — and that token reads and writes state the
    // operator never granted access to.
    expect(isReservedCiVariable('GITLAB_STATE_TOKEN')).toBe(true)
    expect(isReservedCiVariable('GITLAB_STATE_USERNAME')).toBe(true)
    // And in the case a Terraform file would actually declare them in.
    expect(isReservedCiVariable('gitlab_state_token')).toBe(true)
    expect(isReservedCiVariable('gitlab_state_username')).toBe(true)
  })

  it('matches regardless of case and surrounding whitespace', () => {
    expect(isReservedCiVariable('ref')).toBe(true)
    expect(isReservedCiVariable('Tf_Action')).toBe(true)
    expect(isReservedCiVariable('  ORDER_ID  ')).toBe(true)
  })

  it('leaves ordinary parameter names alone', () => {
    for (const name of ['hostname', 'cpu_count', 'REFERENCE', 'TF_ACTIONS', 'branch_name']) {
      expect(isReservedCiVariable(name)).toBe(false)
    }
  })

  it('leaves SIZE orderable', () => {
    // The trigger tail already overrides SIZE for an offering that has sizes, and
    // an offering without them uses it as an ordinary parameter. Reserving it
    // would remove a working field to close nothing.
    expect(isReservedCiVariable('SIZE')).toBe(false)
  })
})

describe('withoutReservedCiVariables', () => {
  it('drops the server-owned names and keeps everything else', () => {
    expect(
      withoutReservedCiVariables({
        hostname: 'web-01',
        REF: 'attacker/branch',
        TF_ACTION: 'destroy',
        cpu: '4',
      }),
    ).toEqual({ hostname: 'web-01', cpu: '4' })
  })

  it('returns a new object rather than emptying the caller\'s', () => {
    const parameters = { REF: 'main' }
    expect(withoutReservedCiVariables(parameters)).toEqual({})
    expect(parameters).toEqual({ REF: 'main' })
  })
})

describe('isPipelineSuppliedVariable', () => {
  /*
   * This list used to be a `CI_INTERNAL_VARS` const copied into BOTH
   * `templateImport.ts` and `sync-parameters/route.ts` — the two paths that turn
   * a template's variables.tf into parameter definitions. Two copies of one
   * list, so a name added to either was still offered by the other. It is one
   * list now, and this is the test that has a reason to fail if it splits again.
   */
  it('covers what the base pipeline hands the template itself', () => {
    for (const name of ['ci_api_url', 'ci_project_id', 'ci_job_token', 'vm_state_name']) {
      expect(isPipelineSuppliedVariable(name), name).toBe(true)
    }
  })

  it('covers the state credentials the base pipeline promotes to TF_VARs', () => {
    // A template reading an upstream step's state declares these and nothing
    // else; offering them as product parameters would ask the operator to type
    // a token the pipeline already supplies — and overwrite it with the answer.
    expect(isPipelineSuppliedVariable('gitlab_state_token')).toBe(true)
    expect(isPipelineSuppliedVariable('gitlab_state_username')).toBe(true)
  })

  it('leaves a template\'s own variables importable', () => {
    for (const name of ['hostname', 'size', 'domain_id', 'disk_gb']) {
      expect(isPipelineSuppliedVariable(name), name).toBe(false)
    }
  })

  it('matches the name a template declares, whitespace aside', () => {
    // Exact-match and lowercase, deliberately: these are Terraform variable
    // names as written. The case-insensitive set is `isReservedCiVariable`,
    // which answers a different question.
    expect(isPipelineSuppliedVariable('  ci_job_token  ')).toBe(true)
    expect(isPipelineSuppliedVariable('CI_JOB_TOKEN')).toBe(false)
  })
})
