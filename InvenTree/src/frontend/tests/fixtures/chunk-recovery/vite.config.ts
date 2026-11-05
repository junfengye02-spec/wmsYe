import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react({ babel: { plugins: ['macros'] } })],
  build: { outDir: '/tmp/wms-chunk-recovery-build', emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 5186, strictPort: true }
});
