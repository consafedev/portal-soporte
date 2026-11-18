import { defineConfig } from 'vitest/config';

/** Limita la configuración de integración a suites que requieren PostgreSQL real aislado. */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
