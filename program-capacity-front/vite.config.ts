import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Same origin as the app, so the httpOnly refresh cookie works exactly as it does in production.
    proxy: { '/api': 'http://localhost:4000' },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    env: { VITE_API_URL: '/api/v1', VITE_SHOW_DEMO_ACCOUNTS: 'false' },
    css: { modules: { classNameStrategy: 'non-scoped' } },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // Declarations only: no behaviour to measure.
      exclude: [
        'src/**/*.spec.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/**/*.d.ts',
        'src/api/**/types.ts',
        'src/api/**/routes.ts',
        'src/api/**/keys.ts',
        'src/constants/**',
        'src/domains/*/index.ts',
      ],
      thresholds: { statements: 100, lines: 100, functions: 100, branches: 99 },
    },
  },
});
