import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      TIMEZONE: 'Asia/Kolkata',
      OFFICE_OPEN: '09:30',
      OFFICE_CLOSE: '19:00',
      EVENING_CLOSE: '21:00',
    },
  },
  resolve: {
    alias: {
      '@': import.meta.dirname,
      // Server modules carry the 'server-only' marker, which throws outside a
      // Server Component. Under the test runner it resolves to the package's
      // own empty build, exactly as it does in the server bundle.
      'server-only': new URL('./tests/stubs/server-only.ts', import.meta.url).pathname,
    },
  },
});
