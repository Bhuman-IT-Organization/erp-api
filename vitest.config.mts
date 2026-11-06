import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { coverage, test } from '@erp/configs/vitest/base';

export default defineConfig({
  plugins: [
    // NestJS needs design:paramtypes metadata; esbuild cannot emit it, SWC can (ADR-0016).
    swc.vite({
      module: { type: 'es6' },
      jsc: { target: 'es2022', transform: { legacyDecorator: true, decoratorMetadata: true } },
    }),
  ],
  test: {
    ...test,
    // packages/** so the workspace packages' own suites (`@erp/contracts`) run in `yarn test`.
    include: ['src/**/*.spec.ts', 'packages/*/__tests__/**/*.spec.ts'],
    exclude: ['src/**/*.int.spec.ts', 'node_modules/**', 'dist/**', 'packages/*/dist/**'],
    coverage: {
      ...coverage,
      // Explicit: the default counts only files a test imported, so an untested file would be invisible (Pitfall 10).
      include: ['src/**/*.ts', 'packages/contracts/src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/__tests__/**',
        'src/shared/db/generated/**',
        'packages/*/__tests__/**',
      ],
      // Today's measured values, floored (D-10, 02-testing TEST-04). Raise only; never lower.
      thresholds: {
        lines: 87,
        branches: 78,
        'src/v1/**/service/*.service.ts': { lines: 98, branches: 89 },
        'src/v1/**/service/*.validator.ts': { lines: 96, branches: 84 },
        'src/v1/**/service/*.{enricher,transformer}.ts': { lines: 100, branches: 86 },
        'src/v1/**/dto/*.ts': { lines: 100, branches: 100 },
        'src/shared/http/guards/**': { lines: 100, branches: 100 },
        'packages/contracts/src/**': { lines: 92, branches: 77 },
      },
    },
  },
});
