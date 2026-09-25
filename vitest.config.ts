import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Flight/AI soak tests simulate minutes of combat; give them room on a loaded machine.
    testTimeout: 120_000,
  },
});
