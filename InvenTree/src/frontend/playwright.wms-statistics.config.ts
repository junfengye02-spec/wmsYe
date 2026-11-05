import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  outputDir: '/tmp/wms-statistics-playwright',
  testMatch: 'pui_wms_statistics.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 45000,
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 1000 },
    baseURL: 'http://127.0.0.1:5183',
    headless: true
  },
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5183 --strictPort',
    url: 'http://127.0.0.1:5183/tests/fixtures/wms-statistics/index.html',
    reuseExistingServer: false
  }
});
