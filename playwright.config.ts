import { defineConfig } from '@playwright/test'
import { getE2eDatabaseUrl, webOrigin, apiOrigin } from './e2e/settings'

const databaseUrl = getE2eDatabaseUrl()

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: webOrigin,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'mobile-chromium', use: {
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    } },
  ],
  webServer: [
    {
      command: 'node node_modules/tsx/dist/cli.mjs e2e/server.ts',
      url: `${apiOrigin}/api/tasks`,
      reuseExistingServer: false,
      env: { E2E_DATABASE_URL: databaseUrl },
      timeout: 60_000,
    },
    {
      command: 'node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3200',
      url: webOrigin,
      reuseExistingServer: false,
      env: { API_INTERNAL_ORIGIN: apiOrigin, NEXT_DIST_DIR: '.next-e2e', NEXT_TELEMETRY_DISABLED: '1' },
      timeout: 180_000,
    },
  ],
})
