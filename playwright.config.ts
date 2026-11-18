import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Configura pruebas de navegador aisladas sobre el servidor local de Next.js. */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: join(tmpdir(), 'portal-soporte-ps003-playwright', String(process.pid)),
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env['CI'] === 'true',
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    browserName: 'chromium',
    headless: true,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
    viewport: { width: 1280, height: 900 },
  },
  webServer: [
    {
      command: 'node tests/e2e/start-auth-api.ts',
      url: 'http://127.0.0.1:4100/api/v1/auth/csrf',
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'corepack pnpm@12.21.0 --filter @portal-soporte/web dev',
      url: 'http://127.0.0.1:3000/login',
      env: {
        API_INTERNAL_ORIGIN: 'http://127.0.0.1:4100',
        NODE_ENV: 'development',
      },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
