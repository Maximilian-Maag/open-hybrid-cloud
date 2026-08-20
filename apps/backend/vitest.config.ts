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
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/test/**', 'src/**/*.test.ts'],
    },
    // Run test files sequentially so DB mutations don't conflict across files
    fileParallelism: false,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
