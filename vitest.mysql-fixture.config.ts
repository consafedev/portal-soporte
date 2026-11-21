import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/mysql-fixture/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 120_000,
    maxWorkers: 1,
    fileParallelism: false,
  },
});
