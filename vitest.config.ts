import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Both workspaces run under one runner; jsdom is only needed for web tests,
    // which opt in via a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['server/src/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}'],
  },
});
