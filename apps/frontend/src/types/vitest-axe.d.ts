import type { AxeResults } from 'axe-core'

/**
 * `toHaveNoViolations`, typed for this version of Vitest.
 *
 * vitest-axe 0.1.0 ships its own augmentation, but against the old global `Vi`
 * namespace — Vitest moved custom matchers to a `'vitest'` module augmentation,
 * so the shipped types apply to nothing here and `tsc` does not see the matcher
 * the setup file registers (issue #102).
 */
interface AxeMatchers<R = unknown> {
  toHaveNoViolations(): R
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = AxeResults> extends AxeMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
