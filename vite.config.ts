/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Relative base so the build works under any GitHub Pages path (/<repo>/).
export default defineConfig({
  base: './',
  test: {
    environment: 'jsdom',
    // A real origin, so localStorage and friends exist.
    environmentOptions: { jsdom: { url: 'http://localhost:5174/' } },
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
  },
});
