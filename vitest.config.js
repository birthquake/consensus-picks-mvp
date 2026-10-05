// FILE LOCATION: vitest.config.js (repo root)

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
  },
});
