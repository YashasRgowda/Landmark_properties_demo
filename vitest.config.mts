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
    alias: { '@': import.meta.dirname },
  },
});
