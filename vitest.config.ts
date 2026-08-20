import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Task 1 ships the toolchain before any test file exists; later tasks add tests.
    passWithNoTests: true,
  },
});
