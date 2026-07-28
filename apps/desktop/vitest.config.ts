import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    pool: 'forks',
    environment: 'node',
    env: {
      // In-memory SQLite for every test run — no file left behind.
      CORD_DB_PATH: ':memory:',
    },
    include: ['src/**/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
