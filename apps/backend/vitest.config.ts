import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    env: {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/open_hybrid_cloud_test',
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
