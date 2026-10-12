// Rules for both code repositories (erp-docs 02-coding-rules/01-typescript-and-lint.md). Every consumer holds
// an identical copy of configs/ (see configs/README.md); change them together.
import jsdoc from 'eslint-plugin-jsdoc';
import erp from './plugin.mjs';

const TIMER_MESSAGE = 'timers live in the door files; durations come from TIMINGS (TS-13)';

/**
 * 01-typescript-and-lint and 04-shared-utilities rules for both code repositories. Every object owns rule ids that no architecture scope
 * touches (never a `no-restricted-imports` or `no-restricted-syntax` object, RESEARCH Pattern 2).
 * `files`: production sources; `tests`: globs the shape rules skip; `timerDoors`: the files allowed to call timers;
 * `docSurface`: the door files whose exports carry TSDoc; `allowGenericFilenames`: POSIX suffixes erp/no-generic-filename accepts.
 * The objects are spread right after the consumer's own global `ignores`; `linterOptions` sits in an object of its own
 * (an object with any key beside `ignores` is not a global ignore): an unused `eslint-disable` is an error everywhere.
 */
export function base({
  files,
  tests,
  timerDoors = [],
  docSurface = [],
  allowGenericFilenames = [],
}) {
  return [
    { linterOptions: { reportUnusedDisableDirectives: 'error' } },
    // TS-08 to TS-17, UTIL-01: code shape
    {
      files,
      ignores: tests,
      plugins: { erp },
      rules: {
        complexity: ['error', 10],
        'max-depth': ['error', 2],
        'no-nested-ternary': 'error',
        'no-else-return': ['error', { allowElseIf: false }],
        'no-lonely-if': 'error',
        'no-await-in-loop': 'error',
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
        '@typescript-eslint/naming-convention': [
          'error',
          { selector: 'typeLike', format: ['PascalCase'] },
        ],
        'erp/no-nested-loops': 'error',
        'erp/no-query-in-loop': 'error',
        'erp/flag-naming': 'error',
        'erp/no-generic-filename': ['error', { allow: allowGenericFilenames }],
      },
    },
    // TS-13: durations come from TIMINGS through a door; own rule ids
    {
      files,
      ignores: [...tests, ...timerDoors],
      rules: {
        'no-restricted-globals': [
          'error',
          { name: 'setTimeout', message: TIMER_MESSAGE },
          { name: 'setInterval', message: TIMER_MESSAGE },
        ],
        'no-restricted-properties': [
          'error',
          { object: 'globalThis', property: 'setTimeout', message: TIMER_MESSAGE },
          { object: 'globalThis', property: 'setInterval', message: TIMER_MESSAGE },
          { object: 'window', property: 'setTimeout', message: TIMER_MESSAGE },
          { object: 'window', property: 'setInterval', message: TIMER_MESSAGE },
        ],
      },
    },
    // TS-17: a loop in a helper, enricher or transformer states its cost
    {
      files: ['**/utils/**/*.{ts,tsx}', '**/*.enricher.ts', '**/*.transformer.ts'],
      ignores: tests,
      plugins: { erp },
      rules: { 'erp/require-complexity-note': 'error' },
    },
    // DOC-01: the door surface is documented (omitted when a consumer names no door surface)
    ...(docSurface.length > 0
      ? [
          {
            files: docSurface,
            ignores: tests,
            plugins: { jsdoc },
            rules: {
              'jsdoc/require-jsdoc': [
                'error',
                {
                  // An empty stub is not documentation, and a fixer must never run on suppressed code (configs/README.md).
                  enableFixer: false,
                  publicOnly: { esm: true },
                  require: {
                    FunctionDeclaration: true,
                    ClassDeclaration: true,
                    ArrowFunctionExpression: true,
                    FunctionExpression: false,
                    MethodDefinition: false,
                  },
                  contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration'],
                },
              ],
            },
          },
        ]
      : []),
  ];
}
