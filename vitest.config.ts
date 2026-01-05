import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false, // Prefer explicit imports for better portability
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'dist/', 'tests/'],
    },
    sequence: {
      // Run tests sequentially to avoid salt file conflicts
      concurrent: false,
    },
  },
});
