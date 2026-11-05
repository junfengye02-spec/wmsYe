import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  outputDir: '/tmp/table-recovery-playwright',
  testMatch: 'pui_table_recovery.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 45000,
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 768 },
    baseURL: 'http://127.0.0.1:5185',
    headless: true
  },
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5185 --strictPort',
    url: 'http://127.0.0.1:5185/tests/fixtures/table-recovery/index.html',
    reuseExistingServer: false
  }
});
