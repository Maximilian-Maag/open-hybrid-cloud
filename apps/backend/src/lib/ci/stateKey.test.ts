import { describe, it, expect } from 'vitest'
import {
  elementStateSuffix,
  namespacedStateKeyBase,
  stateKeyBase,
  stateKeyNamespaceFor,
} from './stateKey'

/**
 * How one element's Terraform state is told apart from every other element's.
 *
 * The module had no test of its own: `webhooks.test.ts` exercised the derivation
 * through the trigger, which covers the happy path and not the three schemes
 * that have to coexist — pre-#183 raw keys, #183 namespaced keys, and the
 * distinguishable form #200 adds.
 */

describe('stateKeyNamespaceFor', () => {
  it('is not a bare number', () => {
    expect(stateKeyNamespaceFor(42)).toBe('o42')
  })

  /*
   * The reason for the letter. A namespaced key is `${readable}-${namespace}`,
   * and an element provisioned before #183 has the raw typed value with no
   * suffix at all. With a bare number, somebody who typed `web-01-42` back then
   * has state `web-01-42` — and a new order 42 typing `web-01` derives exactly
   * that, so the new element's destroy addresses the old element's state.
   */
  it('cannot be produced by a legacy key that ends in an order id', () => {
    const legacyKey = stateKeyBase({ param: 'web-01-42', orderId: '42', namespace: undefined })
    const modernKey = stateKeyBase({
      param: 'web-01',
      orderId: '42',
      namespace: stateKeyNamespaceFor(42),
    })

    expect(legacyKey).toBe('web-01-42')
    expect(modernKey).toBe('web-01-o42')
    expect(modernKey).not.toBe(legacyKey)
  })

  it('accepts the id as a number or a string, and answers the same', () => {
    expect(stateKeyNamespaceFor(7)).toBe(stateKeyNamespaceFor('7'))
  })
})

describe('stateKeyBase', () => {
  // No stack parameter matched: the order id, which the server generates and
  // nothing a customer types can collide with.
  it('falls back to the order id when nothing names the key', () => {
    expect(stateKeyBase({ param: undefined, orderId: '42', namespace: 'o42' })).toBe('42')
  })

  /*
   * An element provisioned before #183 carries no namespace, and its key must
   * stay byte for byte what its own apply used. Re-deriving it differently would
   * point its teardown at a state that does not exist — a worse failure than the
   * bug, because it reports success.
   */
  it('leaves a legacy element with the raw value it was provisioned under', () => {
    expect(stateKeyBase({ param: 'web-01', orderId: '42', namespace: undefined })).toBe('web-01')
  })

  it('namespaces an element that carries one', () => {
    expect(stateKeyBase({ param: 'web-01', orderId: '42', namespace: 'o42' })).toBe('web-01-o42')
  })
})

describe('namespacedStateKeyBase', () => {
  // The value reaches an orchestrator that treats it as a path.
  it.each([
    ['../etc', 'etc-o1'],
    ['..', 'o1'],
    ['-flag', 'flag-o1'],
    ['.hidden', 'hidden-o1'],
    ['web 01/x', 'web-01-x-o1'],
  ])('sanitises %s to %s', (raw, expected) => {
    expect(namespacedStateKeyBase(raw, 'o1')).toBe(expected)
  })

  // Nothing readable survives the sanitising, so the namespace is the whole key
  // — still unique, which is the property that matters.
  it('is the namespace alone when the value sanitises to nothing', () => {
    expect(namespacedStateKeyBase('///', 'o9')).toBe('o9')
  })

  it('truncates a very long value but keeps the namespace', () => {
    const key = namespacedStateKeyBase('x'.repeat(200), 'o5')
    expect(key.endsWith('-o5')).toBe(true)
    expect(key.length).toBeLessThan(80)
  })
})

describe('elementStateSuffix', () => {
  /*
   * Element 1 gets no suffix on purpose: that reproduces, byte for byte, the
   * state name every order placed before quantity existed was provisioned with.
   */
  it.each([
    [undefined, ''],
    ['1', ''],
    [1, ''],
    ['2', '-2'],
    [3, '-3'],
    ['nonsense', ''],
  ])('turns sequence %s into %s', (sequence, expected) => {
    expect(elementStateSuffix(sequence)).toBe(expected)
  })
})
