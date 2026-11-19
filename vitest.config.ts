import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**'],
    // Evita que varios motores PGlite agoten memoria al ejecutarse en procesos paralelos.
    maxWorkers: 2,
  },
});
