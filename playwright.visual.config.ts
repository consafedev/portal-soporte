import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Ejecuta solo revisión visual del cliente con APIs simuladas y Next.js local. */
export default defineConfig({
  testDir: './tests/e2e/visual',
  testMatch: '**/*.visual.spec.ts',
  outputDir: join(tmpdir(), 'portal-soporte-visual-playwright', String(process.pid)),
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
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
  webServer: {
    command: 'corepack pnpm@12.21.0 --filter @portal-soporte/web dev',
    url: 'http://127.0.0.1:3000/login',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      API_INTERNAL_ORIGIN: 'http://127.0.0.1:4100',
      PUBLIC_APP_ORIGIN: 'http://127.0.0.1:3000',
      NODE_ENV: 'development',
      PORTAL_EMAIL_DELIVERY_ENABLED: '',
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      DATABASE_URL: '',
      TEST_DATABASE_URL: '',
      TEST_MIGRATOR_DATABASE_URL: '',
      TEST_DATABASE_ROLE: '',
      TEST_DATABASE_MODE: '',
      TEST_DATABASE_ALLOW_MUTATIONS: '',
      PORTAL_TEST_HARNESS_VERIFIED: '',
      PORTAL_TEST_AUTH_HMAC_KEY: '',
      AUTH_THROTTLE_HMAC_KEY: '',
    },
  },
});
