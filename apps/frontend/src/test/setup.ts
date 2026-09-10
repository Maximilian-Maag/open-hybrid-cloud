import '@testing-library/jest-dom'
import { expect } from 'vitest'
import * as axeMatchers from 'vitest-axe/matchers'

// `toHaveNoViolations`, so the component-level axe checks read the same in every
// test file (issue #102). Registered explicitly rather than via
// `vitest-axe/extend-expect`, whose built entry point is empty in 0.1.0.
expect.extend(axeMatchers)
