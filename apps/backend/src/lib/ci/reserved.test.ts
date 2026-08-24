import { describe, it, expect } from 'vitest'
import { isReservedCiVariable, withoutReservedCiVariables } from './reserved'
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
