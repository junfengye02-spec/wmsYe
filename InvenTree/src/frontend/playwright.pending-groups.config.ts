import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  outputDir: '/tmp/pending-groups-playwright',
  testMatch: 'pui_pending_groups.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 30000,
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 768 },
    baseURL: 'http://127.0.0.1:5187',
    headless: true
  },
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5187 --strictPort',
    url: 'http://127.0.0.1:5187/tests/fixtures/pending-groups/index.html',
    reuseExistingServer: false
  }
});
