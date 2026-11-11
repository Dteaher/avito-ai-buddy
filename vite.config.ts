import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const localApi = { target: 'http://127.0.0.1:3001', changeOrigin: false };

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': localApi,
      '/demo': localApi,
    },
    watch: { ignored: ['**/coverage/**', '**/.data/**'] },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['server/**/*.ts', 'shared/**/*.ts', 'src/**/*.{ts,tsx}'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { lines: 81 },
    },
  },
});
