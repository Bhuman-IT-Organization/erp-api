// Shared Vitest defaults (02-coding-rules/02-testing.md TEST-01, TEST-04). Thresholds are NOT here: they are each
// repository's measured state and live in its own vitest.config.mts.
export const test = { environment: 'node', watch: false };
export const coverage = {
  provider: 'v8',
  reporter: ['text-summary', 'json-summary'],
  reportsDirectory: 'coverage',
};
