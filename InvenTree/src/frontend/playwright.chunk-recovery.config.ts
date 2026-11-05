import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  outputDir: '/tmp/chunk-recovery-playwright',
  testMatch: 'pui_chunk_recovery.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 30000,
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 768 },
    baseURL: 'http://127.0.0.1:5186',
    headless: true
  },
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js build --config tests/fixtures/chunk-recovery/vite.config.ts && node node_modules/vite/bin/vite.js preview --config tests/fixtures/chunk-recovery/vite.config.ts',
    url: 'http://127.0.0.1:5186',
    reuseExistingServer: false
  }
});
