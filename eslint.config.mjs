import { defineConfig } from 'eslint/config';
import { backend } from '@erp/configs/eslint/backend';
import { base } from '@erp/configs/eslint/base';

export default defineConfig(
  {
    ignores: [
      'dist/**',
      'packages/*/dist/**',
      'node_modules/**',
      'coverage/**',
      // Stryker output (test:mutation), per machine; a crashed run leaves its sandbox behind.
      '.stryker-tmp/**',
      'reports/**',
      'src/shared/db/generated/**',
      // The shared configs/ (identical in erp-api and erp-web); linted nowhere.
      'configs/**',
    ],
  },
  ...base({
    files: ['src/**/*.ts', 'packages/contracts/src/**/*.ts'],
    tests: ['src/**/*.spec.ts', 'src/**/__tests__/**', 'packages/*/__tests__/**'],
    timerDoors: ['src/shared/resilience/**', 'src/shared/health/**'],
    docSurface: ['src/shared/**/*.ts', 'src/v1/*/facade/*.ts', 'packages/contracts/src/**/*.ts'],
  }),
  ...backend({ root: import.meta.dirname }),
);
