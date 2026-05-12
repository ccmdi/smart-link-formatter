import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'obsidian': 'obsidian-test-mocks/obsidian',
      'clients': resolve('src/clients'),
      'main': resolve('src/main'),
      'utils': resolve('src/utils'),
      'title-utils': resolve('src/title-utils'),
      'settings': resolve('src/settings'),
      'types/extraction': resolve('src/types/extraction'),
      'types/failure-mode': resolve('src/types/failure-mode'),
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['obsidian-test-mocks/vitest-setup'],
  },
});
