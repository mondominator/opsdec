import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 10000,
    setupFiles: ['./__tests__/setup.js'],
  },
});
