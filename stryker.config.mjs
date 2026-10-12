// PARKED: @stryker-mutator/vitest-runner 10.0.0 runs no tests per mutant under Vitest 5.0.1, so the score is not valid.
// Set break only after a runner release kills mutants in erp-api's permission.guard.ts.
// test:mutation (erp-docs 02-coding-rules/02-testing.md TEST-05): weekly and on demand, never in a hook or check (D-11).
// thresholds.break is the tracked score once unparked: a run's score, floored; raise it, never lower it.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.mts' },
  mutate: [
    'src/v1/**/service/*.{service,validator,enricher,transformer}.ts',
    'src/v1/**/dto/*.ts',
    'src/shared/http/guards/**/*.ts',
    'packages/contracts/src/**/*.ts',
    '!**/__tests__/**',
    '!**/*.spec.ts',
    '!**/*.test.{ts,tsx}',
  ],
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
  thresholds: { high: 80, low: 60, break: null },
};

export default config;
