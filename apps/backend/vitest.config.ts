import { defineConfig } from 'vitest/config'
import path from 'path'
import { testDatabaseUrl } from './src/test/database'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Stryker copies the whole source tree into .stryker-tmp/sandbox-*/ while a
    // mutation run is in progress. Those copies contain test files, so an ordinary
    // `vitest run` picks them up: the suite doubles, and the copies fail against a
    // mutated source — which looks like a broken working tree.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.stryker-tmp/**'],
    setupFiles: ['./src/test/setup.ts'],
    env: {
      // Per working directory, so a mutation run in .stryker-tmp/sandbox-* and an
      // ordinary run in the checkout do not truncate each other's tables. Set
      // TEST_DB_SUFFIX to separate two runs started by hand in one checkout.
      DATABASE_URL: testDatabaseUrl(),
      JWT_SECRET: 'test-jwt-secret-32-chars-minimum!!',
      ADMIN_EMAIL: 'root@test.dev',
      ADMIN_PASSWORD: 'testpassword123',
      // 64 hex characters, so the integration registry (issue #111) is enabled
      // for the suite. Tests that need the UNCONFIGURED behaviour delete this
      // from process.env for the duration of the test — see
      // lib/crypto/secrets.test.ts, and note that the key cache in that module
      // is keyed on the raw value precisely so that works.
      SECRET_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/test/**', 'src/**/*.test.ts'],
    },
    // Files in parallel, each on its own database.
    //
    // `src/test/setup.ts` claims a database at module scope, and Vitest evaluates
    // the setup file once per test file — so concurrent files claim different
    // names through the advisory-lock fall-through in `src/test/database.ts`
    // (`..._2`, `..._3`, …). Nothing is shared between them, which is what makes
    // this safe; before, one shared database made it impossible.
    //
    // Capped rather than left to the default (CPUs - 1): every worker holds a
    // database and a connection pool, and the Postgres they all talk to is the
    // same one, so past a point the workers only queue on it. MAX_CANDIDATES in
    // database.ts is the hard ceiling on this number.
    maxWorkers: 4,
    // Tests WITHIN a file stay sequential: they share the fixtures that the
    // `beforeEach` truncation sets up, so making them concurrent would break them
    // for real rather than merely slowly.
    sequence: { concurrent: false },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
