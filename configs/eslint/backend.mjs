import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import tseslint from 'typescript-eslint';
import vitest from '@vitest/eslint-plugin';

// Architecture rules of erp-api (erp-docs 02-coding-rules/05-backend.md). erp-api, erp-web and
// erp-docs' 05-templates hold identical copies of configs/ (see configs/README.md). Each scope names the rules it
// enforces. Scopes are disjoint (flat config replaces, never merges, a rule's options).
const NEST_HTTP_EXCEPTIONS = [
  'HttpException',
  'BadRequestException',
  'UnauthorizedException',
  'ForbiddenException',
  'NotFoundException',
  'ConflictException',
  'UnprocessableEntityException',
  'InternalServerErrorException',
  'ServiceUnavailableException',
];
// --- entries (reused verbatim in every scope that needs them) ---
const P_NEST_EXCEPTIONS = {
  name: '@nestjs/common',
  importNames: NEST_HTTP_EXCEPTIONS,
  message: 'throw AppError(code) (02-coding-rules/05-backend.md BE-09)',
};
const P_HTTP_LIBS = ['axios', 'got', 'node-fetch', 'undici'].map((name) => ({
  name,
  message: 'built-in fetch behind shared/resilience only (ADR-0031 §6, BE-18)',
}));
const P_PRISMA = {
  name: '@prisma/client',
  message: 'only repository/*.repository.ts touches Prisma (DB-04, BE-08)',
};
const P_NODEMAILER = {
  name: 'nodemailer',
  message: 'only src/integrations/adapters/email/ imports nodemailer (BE-16 rule 4, ADR-0049)',
};
// (?!shared/|integrations/): `../../../shared/...` and `../../integrations/...` are NOT another module (checker blocker 2)
const G_CROSS_MODULE = {
  regex:
    '^(\\.\\./)+(?!shared/|integrations/)[a-z0-9-]+/(controller|service|repository|model|dto|events|facade)/',
  message: 'import another module through its index.js only (BE-03)',
};
const G_ADAPTERS = {
  group: ['**/adapters/**'],
  message: 'adapters are wired in integrations.module.ts; everything else sees ports only (BE-16)',
};
const G_PRISMA = {
  group: ['**/shared/db/generated/**', '**/shared/db/prisma.service.js'],
  message: 'only repository/*.repository.ts touches Prisma (DB-04, BE-08)',
};
const G_RESILIENCE = {
  group: ['**/shared/resilience/*'],
  message: 'only a transport file calls the resilience layer (ADR-0031 §3, BE-18)',
};
const G_V1_FROM_SHARED = {
  regex: '/v1/',
  message: 'shared/ never imports v1/: declare a port (BE-20)',
};
const S_FETCH = [
  {
    selector: 'CallExpression[callee.name="fetch"]',
    message: 'fetch only in service/*.transport.ts (ADR-0031 §3, BE-18)',
  },
  {
    selector: 'MemberExpression[object.name="globalThis"][property.name="fetch"]',
    message: 'fetch only in service/*.transport.ts (ADR-0031 §3, BE-18)',
  },
];
const S_PROCESS_ENV = {
  selector: 'MemberExpression[object.name="process"][property.name="env"]',
  message: 'process.env only in shared/config/env.schema.ts (BE-06)',
};
const S_TRY = {
  selector: 'TryStatement',
  message: 'controllers never catch; ProblemDetailsFilter answers (BE-08)',
};
/**
 * A permission name is written down in exactly two places (ADR-0033 §Enforcement): the catalogue and
 * mapping in `packages/contracts/src/**` (scope 13: also the only file in either repository that may
 * carry a Perfex code) and the module's own `*.routes.ts` permission map (scope 12), which reads its
 * codes from there. `S_PERMISSION_ARG` is the pair of positions a code is *used* in: an argument of
 * `@Permissions`/`@PermissionsAny` or of `hasPermission()`; `S_PERMISSION_LITERAL` adds the clean
 * `module.resource.action` grammar itself. A spec scope carries `S_PERMISSION_DECORATOR` alone,
 * because a spec calls `hasPermission('a.b')` to drive the code under test.
 *
 * The grammar half is deliberately absent from `src/v1/**\/events/*.ts` (scope 14) and from the
 * spec scopes: BE-13's event name `<module>.<entity>.<verb-ed>` is the same grammar, and the guard's
 * own spec constructs codes literally to test the guard.
 */
const S_PERMISSION_DECORATOR = {
  selector: String.raw`CallExpression[callee.name=/^Permissions(Any)?$/] > Literal[value=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/]`,
  message:
    '@Permissions/@PermissionsAny take a constant from the module’s *.routes.ts map, whose codes come from @erp/contracts (ADR-0033 §Enforcement)',
};
const S_PERMISSION_ARG = [
  S_PERMISSION_DECORATOR,
  {
    selector: String.raw`CallExpression[callee.property.name="hasPermission"] > Literal[value=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/]`,
    message:
      'hasPermission() takes a constant from the module’s *.routes.ts map, whose codes come from @erp/contracts (ADR-0033 §Enforcement)',
  },
];
const S_PERMISSION_LITERAL = [
  {
    selector: String.raw`Literal[value=/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){2}$/]`,
    message:
      'a permission name belongs in @erp/contracts (packages/contracts/src/permissions.catalogue.ts) and reaches code through the module’s *.routes.ts map (ADR-0033 §Enforcement)',
  },
  ...S_PERMISSION_ARG,
];
// UTIL-03: banned in every scope; appended inside scope(), never a second no-restricted-imports object (Pattern 2)
const P_BANNED_LIBS = [
  {
    name: 'lodash',
    message:
      'the standard library first (Object.groupBy, structuredClone, array methods); a library only by trigger (UTIL-03)',
  },
  {
    name: 'moment',
    message:
      'Intl through the format doors; date-fns arrives with the first date arithmetic (UTIL-03)',
  },
];
const G_BANNED_LIBS = {
  group: ['lodash/*', 'lodash-es', 'lodash-es/*', 'moment-timezone', 'moment-timezone/*'],
  message: 'the standard library first; date and money libraries arrive only by trigger (UTIL-03)',
};
/**
 * One scope = one complete config for both rules. `files`/`ignores` of all scopes are mutually exclusive.
 * `P_NODEMAILER` is appended here, so a new scope inherits it; `allowNodemailer` is true for scope 16 only.
 */
const scope = (
  files,
  ignores,
  { paths = [], patterns = [], syntax = [], allowNodemailer = false },
) => ({
  files,
  ignores,
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [...paths, ...(allowNodemailer ? [] : [P_NODEMAILER]), ...P_BANNED_LIBS],
        patterns: [...patterns, G_BANNED_LIBS],
      },
    ],
    'no-restricted-syntax': syntax.length > 0 ? ['error', ...syntax] : 'off',
  },
});
const V1_TRANSPORT = 'src/v1/**/service/*.transport.ts';
const V1_REPOSITORY = 'src/v1/**/repository/*.repository.ts';
const V1_CONTROLLER = 'src/v1/**/controller/*.ts';
const V1_ROUTES = 'src/v1/**/*.routes.ts';
const V1_EVENTS = 'src/v1/**/events/*.ts';
const V1_TESTS = ['src/v1/**/__tests__/**', 'src/v1/**/*.spec.ts'];
const V1_INT_SPECS = 'src/v1/**/*.int.spec.ts';
const CONTRACTS = 'packages/contracts/src/**/*.ts';
const EMAIL_ADAPTER = 'src/integrations/adapters/email/*.ts';
/**
 * The workspace packages' own specs. Written as `packages/*` rather than as
 * `packages/contracts`: the defect this fixes was a literal (`ROOT_SOURCES = ['proxy.ts']` in
 * erp-web) patched with another literal, so the second package added must be
 * covered by construction. Before this, `packages/contracts/__tests__/**` matched **no
 * configuration object at all**: `eslint .` skipped the directory, so no `no-console`, no
 * `vitest/no-focused-tests` (an `it.only` there would have shipped) and no typed rules.
 */
const PACKAGE_TESTS = 'packages/*/__tests__/**/*.ts';
const V1_BASE = {
  paths: [P_NEST_EXCEPTIONS, ...P_HTTP_LIBS, P_PRISMA],
  patterns: [G_CROSS_MODULE, G_ADAPTERS, G_PRISMA, G_RESILIENCE],
  syntax: [...S_FETCH, S_PROCESS_ENV, ...S_PERMISSION_LITERAL],
};
/**
 * Hygiene (BE-24; no-console is BE-10): two single-purpose objects after the sixteen scopes. Neither
 * touches `no-restricted-*`, so they cannot collide with a scope (flat config replaces per rule id).
 * The server logs only through LoggerService (`pretty` format is the development mode); every
 * `eslint-disable` carries a `-- reason` and an unused one is an error.
 */
const HYGIENE = {
  files: ['src/**/*.ts', CONTRACTS, PACKAGE_TESTS],
  plugins: { '@eslint-community/eslint-comments': eslintComments },
  rules: {
    'no-console': 'error',
    'no-debugger': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    eqeqeq: ['error', 'always'],
    'no-var': 'error',
    'prefer-const': 'error',
    'no-param-reassign': ['error', { props: false }],
    'no-return-await': 'off', // typescript-eslint's return-await (strict preset) owns it
    '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
  },
};
const TEST_HYGIENE = {
  files: ['src/**/*.spec.ts', 'src/**/__tests__/**/*.ts', PACKAGE_TESTS],
  plugins: { vitest },
  rules: {
    'vitest/no-focused-tests': 'error', // no `.only` ever reaches main
    'vitest/no-disabled-tests': 'error', // D-23: no `.skip` reaches main either
    'vitest/expect-expect': 'error',
    'vitest/no-identical-title': 'error',
  },
};
const SCOPES = [
  // 1 v1 default: every v1 file that no narrower scope below claims
  scope(
    ['src/v1/**/*.ts'],
    [V1_TRANSPORT, V1_REPOSITORY, V1_CONTROLLER, V1_ROUTES, V1_EVENTS, ...V1_TESTS],
    V1_BASE,
  ),
  // 2 v1 transport: may fetch and call shared/resilience (BE-18)
  scope([V1_TRANSPORT], [...V1_TESTS], {
    paths: [P_NEST_EXCEPTIONS, ...P_HTTP_LIBS, P_PRISMA],
    patterns: [G_CROSS_MODULE, G_ADAPTERS, G_PRISMA],
    syntax: [S_PROCESS_ENV, ...S_PERMISSION_LITERAL],
  }),
  // 3 v1 repository: may import Prisma (DB-04)
  scope([V1_REPOSITORY], [...V1_TESTS], {
    paths: [P_NEST_EXCEPTIONS, ...P_HTTP_LIBS],
    patterns: [G_CROSS_MODULE, G_ADAPTERS, G_RESILIENCE],
    syntax: [...S_FETCH, S_PROCESS_ENV, ...S_PERMISSION_LITERAL],
  }),
  // 4 v1 controller: the default plus the `try` ban (BE-08)
  scope([V1_CONTROLLER], [...V1_TESTS], { ...V1_BASE, syntax: [...V1_BASE.syntax, S_TRY] }),
  // 5 v1 unit tests: fakes may fetch, transport specs may import resilience, assertions may name Nest exceptions
  scope(V1_TESTS, [V1_INT_SPECS], {
    paths: [...P_HTTP_LIBS, P_PRISMA],
    patterns: [G_CROSS_MODULE, G_ADAPTERS, G_PRISMA],
    syntax: [S_PROCESS_ENV, S_PERMISSION_DECORATOR],
  }),
  // 6 v1 int specs: read process.env.DATABASE_URL to skip themselves (README "Known deviations"), touch Prisma
  scope([V1_INT_SPECS], [], {
    paths: [...P_HTTP_LIBS],
    patterns: [G_CROSS_MODULE, G_ADAPTERS],
    syntax: [S_PERMISSION_DECORATOR],
  }),
  // 7 shared: never imports v1 (BE-20), never reads process.env (BE-06)
  scope(['src/shared/**/*.ts'], ['src/shared/config/env.schema.ts', 'src/shared/**/*.spec.ts'], {
    paths: [...P_HTTP_LIBS],
    patterns: [G_V1_FROM_SHARED, G_ADAPTERS],
    syntax: [S_PROCESS_ENV, ...S_PERMISSION_LITERAL],
  }),
  // 8 env schema: the only process.env reader (BE-06)
  scope(['src/shared/config/env.schema.ts'], [], {
    paths: [...P_HTTP_LIBS],
    patterns: [G_V1_FROM_SHARED, G_ADAPTERS],
  }),
  // 9 shared specs: int specs read process.env; the permission entries are absent because the
  //   guard's own spec (`shared/http/guards/__tests__/permission.guard.spec.ts`) constructs codes
  //   literally to test the guard, and an event name has the same grammar as a clean permission name
  scope(['src/shared/**/*.spec.ts'], [], {
    paths: [...P_HTTP_LIBS],
    patterns: [G_V1_FROM_SHARED, G_ADAPTERS],
  }),
  // 10 root + integrations: main.ts is the composition root and may import v1/auth/index.js (BE-20)
  scope(
    ['src/*.ts', 'src/integrations/**/*.ts'],
    ['src/integrations/integrations.module.ts', EMAIL_ADAPTER, 'src/**/*.spec.ts'],
    {
      paths: [...P_HTTP_LIBS],
      patterns: [G_ADAPTERS],
      syntax: [S_PROCESS_ENV, ...S_PERMISSION_LITERAL],
    },
  ),
  // 11 integrations module: the one place adapters are wired (BE-16)
  scope(['src/integrations/integrations.module.ts'], [], {
    paths: [...P_HTTP_LIBS],
    patterns: [],
    syntax: [S_PROCESS_ENV, ...S_PERMISSION_LITERAL],
  }),
  // 12 v1 routes: a module's own permission map, one of the two homes of a permission name
  //    (ADR-0033 §Enforcement); everything else of scope 1 still applies
  scope([V1_ROUTES], [...V1_TESTS], {
    ...V1_BASE,
    syntax: [...S_FETCH, S_PROCESS_ENV],
  }),
  // 13 @erp/contracts: the catalogue and the Perfex mapping: the other home of a permission name,
  //    and the only file in either repository that may carry a Perfex code. Its `__tests__` share
  //    the scope (SF-5): a spec that asserts the mapping must name both halves of every pair, so
  //    the permission-literal restriction has to be the same one the source gets.
  scope([CONTRACTS, PACKAGE_TESTS], [], {
    paths: [...P_HTTP_LIBS],
    patterns: [G_V1_FROM_SHARED, G_ADAPTERS],
    syntax: [S_PROCESS_ENV],
  }),
  // 14 v1 events: `published.ts` / `subscribed.ts`: BE-13's event name `<module>.<entity>.<verb-ed>`
  //    is the clean-permission grammar, so only the permission *use* positions are restricted here
  scope([V1_EVENTS], [...V1_TESTS], {
    ...V1_BASE,
    syntax: [...S_FETCH, S_PROCESS_ENV, ...S_PERMISSION_ARG],
  }),
  // 16 email adapter: the one place nodemailer may be imported (BE-16 rule 4, ADR-0049); otherwise scope 10's entries
  scope([EMAIL_ADAPTER], ['src/**/*.spec.ts'], {
    paths: [...P_HTTP_LIBS],
    patterns: [G_ADAPTERS],
    syntax: [S_PROCESS_ENV, ...S_PERMISSION_LITERAL],
    allowNodemailer: true,
  }),
  // 15 magic numbers: durations and thresholds are named constants (TIMINGS, ADR-0031 §1); its own rule, so it may overlap the scopes above
  {
    files: ['src/v1/**/*.ts', 'src/shared/**/*.ts', 'src/integrations/**/*.ts'],
    ignores: ['src/shared/config/*.ts', 'src/**/*.spec.ts', 'src/**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [-1, 0, 1, 2],
          ignoreEnums: true,
          ignoreReadonlyClassProperties: true,
          ignoreNumericLiteralTypes: true,
          ignoreTypeIndexes: true,
          ignoreArrayIndexes: true,
          detectObjects: false,
          enforceConst: true,
        },
      ],
    },
  },
];

/** erp-api's typed base, scopes 1-16, HYGIENE and TEST_HYGIENE. `root` is the consumer's folder. */
export function backend({ root }) {
  return [
    {
      files: ['src/**/*.ts', CONTRACTS, PACKAGE_TESTS],
      extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir: root },
      },
      rules: {
        // Nest modules are decorated empty classes by design.
        '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      },
    },
    ...SCOPES,
    // hygiene: single-purpose objects, no `no-restricted-*` (BE-24; `no-console` is BE-10)
    HYGIENE,
    // test hygiene: every spec and __tests__ helper
    TEST_HYGIENE,
  ];
}
