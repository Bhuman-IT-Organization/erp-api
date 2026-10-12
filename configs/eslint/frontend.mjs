import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
// Imported only to read `flatConfigs.recommended.rules` (S19): eslint-config-next already registers the plugin under `jsx-a11y`.
import jsxA11y from 'eslint-plugin-jsx-a11y';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import tseslint from 'typescript-eslint';
import vitest from '@vitest/eslint-plugin';

// Architecture rules of erp-web (erp-docs 02-coding-rules/06-frontend.md). erp-api, erp-web and
// erp-docs' 05-templates hold identical copies of configs/ (see configs/README.md). Each scope names the rules it
// enforces. Scopes are disjoint (flat config replaces, never merges, a rule's options).
const LAYERS = ['atoms', 'molecules', 'organisms', 'templates'];
const ABOVE = {
  atoms: ['molecules', 'organisms', 'templates'],
  molecules: ['organisms', 'templates'],
  organisms: ['templates'],
  templates: [],
};
// `types/**` is folded in (SF-5): its only inhabitant is `next-testing.d.ts`, the upstream shim
// `__tests__/proxy.test.ts` needs, so it belongs to the test surface: and before this it was in no
// configuration object at all.
const TESTS = [
  '**/__tests__/**',
  '**/*.test.{ts,tsx}',
  'src/test/**',
  '**/*.stories.tsx',
  'types/**',
]; // __tests__ placement (lead 2026-09-20): src/test/** harnesses and stories stay test-scoped
// --- entries (reused verbatim in every scope that needs them) ---
const P_AXIOS = {
  name: 'axios',
  message: 'only src/lib/api/http.ts imports axios (ADR-0002, ADR-0031 §5, FE-08)',
};
const P_AXIOS_TYPES = { ...P_AXIOS, allowTypeImports: true }; // S5 only: call-api.ts imports the adapter TYPES (the test seam); a value import still fires
const P_SWR = ['swr', 'swr/mutation'].map((name) => ({
  name,
  message: 'SWR only through src/lib/api (useCommonApi / useCommonMutation) (FE-08)',
}));
// ADR-0041, M9: resumable uploads have ONE door, src/lib/api/upload-file.ts (S27). Every scope carries
// P_TUS but S27 and S12 (tests and stories fake the Upload class).
const P_TUS = {
  name: 'tus-js-client',
  message: 'only src/lib/api/upload-file.ts imports tus-js-client (ADR-0041, M9)',
};
// FE-15: URL state has ONE door, src/lib/url (useListQueryState + UrlStateProvider). Every scope carries
// P_NUQS except S5 (src/lib default, which holds src/lib/url; a scope of its own would move
// `21 + FEATURES.length`); S12 (tests, harnesses, .storybook) may import the testing adapter only.
const P_NUQS = ['nuqs', 'nuqs/adapters/next/app', 'nuqs/adapters/testing'].map((name) => ({
  name,
  message: 'URL state only through src/lib/url (useListQueryState) (FE-15)',
}));
const P_NUQS_BUT_TESTING = P_NUQS.filter(({ name }) => name !== 'nuqs/adapters/testing');
const P_LUCIDE = {
  name: 'lucide-react',
  message: 'icons only through the Icon atom (src/components/atoms/Icon) (FE-14)',
};
// next-themes arrived only because `corepack yarn ui:add sonner` generates a `ui/sonner.tsx` that
// imports `useTheme` from it. It is NOT this product's theming mechanism: colours are CSS variables
// the api serves per customer (W0-05). `src/components/ui/**` is outside every scope below, so the
// generated primitive keeps its import and everything we write cannot reach for it (FE-17).
const P_NEXT_THEMES = {
  name: 'next-themes',
  message:
    'theme values come from /api/v1/branding as :root variables, never a theme library (FE-17)',
};
const G_HTTP = {
  regex: '^@/lib/api/(http|swr-config)$',
  message: 'only call-api.ts and SwrProvider use the instance and the policy (FE-08)',
};
const G_CALL_API = {
  regex: '^@/lib/api/call-api$',
  message: 'components call feature hooks or feature api functions, never callApi (FE-08)',
};
const G_FEATURE_INTERNALS = (self) => ({
  regex: `^@/features/(?!${self}/)[a-z0-9-]+/`,
  message: 'another feature only through @/features/<name> (its index.ts) (FE-07)',
});
const G_FEATURE_COMPONENTS = {
  regex: '^@/features/[a-z0-9-]+/components/',
  message: 'a route renders a feature PAGE, not a component (FE-01)',
};
const G_ANY_FEATURE = {
  regex: '^@/features/',
  message: 'src/lib and src/components never import a feature (FE-01)',
};
const G_COMPONENTS_FROM_LIB = {
  regex: '^@/components/',
  message: 'src/lib never imports a component (FE-01)',
};
const G_UPWARD = (layer) => ({
  regex: `^@/components/(${ABOVE[layer].join('|')})/`,
  message: 'atomic layers import downward only (FE-06)',
});
const S_FETCH = [
  {
    selector: 'CallExpression[callee.name="fetch"]',
    message:
      'fetch only in src/lib/api/server-fetch.ts (server) and src/features/auth/api/legacy-handoff.ts (the named exception); browser calls go through callApi (FE-09)',
  },
  {
    selector: 'MemberExpression[object.name="globalThis"][property.name="fetch"]',
    message: 'fetch only in src/lib/api/server-fetch.ts and legacy-handoff.ts (FE-09)',
  },
];
const S_PROCESS_ENV = {
  selector: 'MemberExpression[object.name="process"][property.name="env"]',
  message: 'process.env only in src/lib/config/env.ts (FE-03; src/lib/log.ts may read NODE_ENV)',
};
const S_INTL = [
  // a CONSTANT, never an own config object: as an own object it would REPLACE every scope's no-restricted-syntax (measured: fetch lost in S1)
  {
    selector: 'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]',
    message:
      'format dates, numbers and currency through src/lib/i18n/format.ts (client) or format.server.ts (server), never inline (FE-26)',
  },
  {
    selector: 'MemberExpression[object.name="Intl"]',
    message: 'Intl only inside src/lib/i18n/format.ts / format.server.ts (FE-26)',
  },
  {
    selector: 'NewExpression[callee.object.name="Intl"]',
    message: 'Intl only inside src/lib/i18n/format.ts / format.server.ts (FE-26)',
  },
];
const S_USE_EFFECT = [
  {
    selector: 'CallExpression[callee.name="useEffect"]',
    message: 'useEffect only in src/lib/hooks/** with a // effect: comment (FE-04)',
  },
  {
    selector: 'CallExpression[callee.property.name="useEffect"]',
    message: 'useEffect only in src/lib/hooks/** with a // effect: comment (FE-04)',
  },
];
const S_SVG = {
  selector: 'JSXOpeningElement[name.name="svg"]',
  message:
    'inline <svg> only in the Icon atom; a 1:1 legacy glyph needs a justified disable naming the view (FE-14)',
};
const S_HEX = {
  selector: 'Literal[value=/#[0-9a-fA-F]{3,8}([ ]|$|;|\\])/]',
  message:
    'no colour literal: theme tokens come from /api/v1/branding (W0-05, FE-17); a legacy-view colour needs a justified disable naming the view',
};
/**
 * ADR-0033 §Enforcement / D-16: a clean permission name (`module.resource.action`) is written down in
 * `src/config/permissions.ts` (the `@erp/contracts` mirror) and nowhere else.
 *
 * A CONSTANT, never its own config object. The warning above `S_INTL` is measured, not theoretical:
 * flat config REPLACES `no-restricted-syntax` options per file, so an own object would silently drop
 * every other selector from every scope it matched (`fetch` was lost in S1). `S_ALL` is spread into
 * every scope's `syntax:`, so folding it in is the only correct form. The grammar is erp-api's
 * `S_PERMISSION_LITERAL` byte for byte, so the same literal is refused on both sides of the wire.
 */
const S_PERMISSION_LITERAL = {
  selector: String.raw`Literal[value=/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){2}$/]`,
  message:
    'a permission name belongs in src/config/permissions.ts (the @erp/contracts mirror) and reaches code as a PERMISSIONS constant: ADR-0033 §Enforcement, D-16 (FE-16)',
};
const PHYSICAL =
  '(^|[ ]|:)(-?(ml|mr|pl|pr|left|right|rounded-l|rounded-r|border-l|border-r|scroll-ml|scroll-mr|inset-l|inset-r)-|text-left|text-right|float-left|float-right)';
const S_PHYSICAL = [
  {
    selector: `Literal[value=/${PHYSICAL}/]`,
    message:
      'physical direction class; use ms/me/ps/pe/start/end/rounded-s/rounded-e/border-s/border-e/text-start/text-end so RTL is a locale switch (FE-20)',
  },
  {
    selector: `TemplateElement[value.raw=/${PHYSICAL}/]`,
    message: 'physical direction class; use the logical utility (FE-20)',
  },
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
/** One scope = one complete config for both rules. `files`/`ignores` of all scopes are mutually exclusive. */
const scope = (files, ignores, { paths = [], patterns = [], syntax = [] }) => ({
  files,
  ignores,
  rules: {
    'no-restricted-imports': [
      'error',
      { paths: [...paths, ...P_BANNED_LIBS], patterns: [...patterns, G_BANNED_LIBS] },
    ],
    'no-restricted-syntax': syntax.length > 0 ? ['error', ...syntax] : 'off',
  },
});
const S_UI = [S_SVG, S_HEX, ...S_PHYSICAL];
const S_ALL = [...S_FETCH, S_PROCESS_ENV, ...S_USE_EFFECT, ...S_INTL, S_PERMISSION_LITERAL]; // hand-built syntax lists (S3, S4, S6, S7, S10, S21, S22) spread ...S_INTL explicitly
const LEGACY_HANDOFF = 'src/features/auth/api/legacy-handoff.ts';
const UPLOAD_DOOR = 'src/lib/api/upload-file.ts';
const LIB_DOORS = [
  'src/lib/api/http.ts',
  UPLOAD_DOOR,
  'src/lib/api/server-fetch.ts',
  'src/lib/config/env.ts',
  'src/lib/hooks/**',
  'src/lib/log.ts',
  'src/lib/i18n/format.ts',
  'src/lib/i18n/format.server.ts',
];
const LIB_RESTRICTIONS = { patterns: [G_ANY_FEATURE, G_COMPONENTS_FROM_LIB] };
const CONFIG_LAYER = 'src/config/**/*.ts';
/** The one file allowed to hold clean permission names (D-16); its scope drops S_PERMISSION_LITERAL. */
const PERMISSIONS_MIRROR = 'src/config/permissions.ts';
/** Next 16's proxy: a ROOT file, so it is outside `app/**` and `src/**` and needs naming twice. */
const HOCS = 'src/hocs/**/*.tsx';
const PROXY = 'proxy.ts';
/** The root build config and the root ambient declarations: S27's two halves (SF-5). */
const ROOT_CONFIG = 'next.config.ts';
const ROOT_DECLARATIONS = '*.d.ts';
const ALL_SOURCE = ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}', PROXY];
/**
 * Single-purpose objects after the scopes (S13–S19): each owns rule ids no scope touches, so they
 * may overlap the scopes freely (flat config replaces per rule id).
 */
// S13 magic numbers: durations live in client-timings.ts / server-timings.ts (ADR-0031 §1/§5)
const MAGIC_NUMBERS = {
  files: ALL_SOURCE,
  ignores: [
    'src/lib/api/client-timings.ts',
    'src/lib/config/server-timings.ts',
    'src/components/ui/**',
    ...TESTS,
  ],
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
};
// S14 react: every hook dependency is declared (FE-04); `react/no-danger` has ONE home: S17
const REACT = {
  files: ALL_SOURCE,
  ignores: ['src/components/ui/**'],
  rules: { 'react-hooks/exhaustive-deps': 'error' },
};
// S15 i18n literals: text reaches JSX only through message keys (FE-08); `allowedStrings` decided by the spike (A8)
const I18N_LITERALS = {
  files: ['app/**/*.tsx', 'src/features/**/*.tsx', 'src/components/**/*.tsx'],
  ignores: ['src/components/ui/**', ...TESTS],
  rules: {
    'react/jsx-no-literals': [
      'error',
      {
        noStrings: true,
        ignoreProps: true,
        noAttributeStrings: false,
        allowedStrings: ['…', ':', '/', '(', ')'],
      },
    ],
  },
};
// S16 no-console: src/lib/log.ts is the one sink (lead 2026-09-20)
const NO_CONSOLE = {
  files: ALL_SOURCE,
  ignores: ['src/lib/log.ts', ...TESTS],
  rules: { 'no-console': 'error' },
};
// S17 hygiene (lead 2026-09-20): plus every `eslint-disable` carries a `-- reason`; an UNUSED directive is an error through `linterOptions` on the first object
const HYGIENE = {
  files: ALL_SOURCE,
  ignores: [...TESTS],
  plugins: { '@eslint-community/eslint-comments': eslintComments },
  rules: {
    'no-debugger': 'error',
    'no-alert': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    eqeqeq: ['error', 'always'],
    'no-var': 'error',
    'prefer-const': 'error',
    'no-param-reassign': ['error', { props: false }],
    'react/no-danger': 'error',
    '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
  },
};
// S18 test hygiene: no `.only` ever reaches main
const TEST_HYGIENE = {
  files: [...TESTS],
  plugins: { vitest },
  rules: {
    'vitest/no-focused-tests': 'error',
    'vitest/no-disabled-tests': 'error', // D-23: no `.skip` reaches main either
    'vitest/expect-expect': 'error',
    'vitest/no-identical-title': 'error',
  },
};
// S19 a11y (lead 2026-09-20): jsx-a11y recommended in full; `no-autofocus` off by lead decision: the login form keeps the legacy `autofocus` (1:1 parity, FE-25).
// No `plugins` key: eslint-config-next registers `jsx-a11y` already (registering the module again throws "Cannot redefine plugin").
const A11Y = {
  files: ['app/**/*.tsx', 'src/components/**/*.tsx', 'src/features/**/*.tsx'],
  ignores: ['src/components/ui/**', ...TESTS],
  rules: { ...jsxA11y.flatConfigs.recommended.rules, 'jsx-a11y/no-autofocus': 'off' },
};

/** erp-web's Next rule sets, typed base, scopes S1-S12 and S21-S26, then S13-S19. `root` is the consumer's folder. */
export function frontend({ root }) {
  const FEATURES = readdirSync(join(root, 'src/features'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  return [
    ...nextVitals,
    ...nextTs,
    {
      // Root sources are matched as `*.{ts,tsx}` rather than by name (SF-5): naming `proxy.ts` here
      // is what left `next.config.ts` and `reset.d.ts` on Next's base rules only (no typed rules, no
      // no-floating-promises) and `types/**` and the root `__tests__/**` were missing for the same
      // reason. `tsconfig.json` already includes `**/*.ts`, so projectService resolves all of them.
      files: [
        'app/**/*.{ts,tsx}',
        'src/**/*.{ts,tsx}',
        'types/**/*.{ts,tsx}',
        '__tests__/**/*.{ts,tsx}',
        '*.{ts,tsx}',
      ],
      extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir: root },
      },
    },
    // S1 app/: routes: a page imports @/features/*/pages|api and @/features/<name>, never a component or callApi (FE-01)
    scope(['app/**/*.{ts,tsx}'], [], {
      paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, ...P_SWR, P_LUCIDE, P_TUS],
      patterns: [G_HTTP, G_CALL_API, G_FEATURE_COMPONENTS],
      syntax: [...S_ALL, ...S_UI],
    }),
    // S2 (× feature): a feature reaches another only through @/features/<name> (FE-07); ui/* directly, callApi in api/*.ts, hooks from @/lib/api/*
    ...FEATURES.map((f) =>
      scope([`src/features/${f}/**/*.{ts,tsx}`], [...TESTS, LEGACY_HANDOFF], {
        paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, ...P_SWR, P_LUCIDE, P_TUS],
        patterns: [G_HTTP, G_FEATURE_INTERNALS(f)],
        syntax: [...S_ALL, ...S_UI],
      }),
    ),
    // S3 the legacy handoff: the one browser-side raw fetch (a different upstream, FE-09)
    scope([LEGACY_HANDOFF], [], {
      paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, ...P_SWR, P_TUS],
      patterns: [G_HTTP],
      syntax: [S_PROCESS_ENV, ...S_USE_EFFECT, ...S_INTL],
    }),
    // S4 the axios instance (FE-08)
    scope(['src/lib/api/http.ts'], [], {
      paths: [...P_NUQS, P_TUS],
      ...LIB_RESTRICTIONS,
      syntax: [...S_FETCH, S_PROCESS_ENV, ...S_USE_EFFECT, ...S_INTL],
    }),
    // S5 src/lib default: swr lives here; call-api.ts imports the axios TYPES only (allowTypeImports)
    scope(['src/lib/**/*.{ts,tsx}'], [...LIB_DOORS, ...TESTS], {
      paths: [P_AXIOS_TYPES, P_NEXT_THEMES, P_LUCIDE, P_TUS],
      ...LIB_RESTRICTIONS,
      syntax: [...S_ALL, ...S_UI],
    }),
    // S6 env.ts: the one process.env reader (FE-03)
    scope(['src/lib/config/env.ts'], [], {
      paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, P_TUS],
      ...LIB_RESTRICTIONS,
      syntax: [...S_FETCH, ...S_USE_EFFECT, ...S_INTL],
    }),
    // S7 server-fetch.ts: the one server-side fetch (FE-09)
    scope(['src/lib/api/server-fetch.ts'], [], {
      paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, ...P_SWR, P_TUS],
      ...LIB_RESTRICTIONS,
      syntax: [S_PROCESS_ENV, ...S_USE_EFFECT, ...S_INTL],
    }),
    // S8 (× layer): atomic layers import downward only (FE-06); stores from @/lib/api/api-status, props
    ...LAYERS.map((layer) =>
      scope([`src/components/${layer}/**/*.{ts,tsx}`], ['src/components/atoms/Icon/**', ...TESTS], {
        paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, ...P_SWR, P_LUCIDE, P_TUS],
        patterns: [
          G_HTTP,
          G_CALL_API,
          G_ANY_FEATURE,
          ...(ABOVE[layer].length > 0 ? [G_UPWARD(layer)] : []),
        ],
        syntax: [...S_ALL, ...S_UI],
      }),
    ),
    // S9 the Icon atom: lucide-react and inline <svg> live here (FE-14)
    scope(['src/components/atoms/Icon/**/*.{ts,tsx}'], [...TESTS], {
      paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, ...P_SWR, P_TUS],
      patterns: [G_HTTP, G_CALL_API, G_ANY_FEATURE],
      syntax: [...S_ALL, S_HEX, ...S_PHYSICAL],
    }),
    // S10 src/lib/hooks: the one home of useEffect (FE-04; the shape spec demands the `// effect:` comment)
    scope(['src/lib/hooks/**/*.{ts,tsx}'], [...TESTS], {
      paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, P_LUCIDE, P_TUS],
      ...LIB_RESTRICTIONS,
      syntax: [...S_FETCH, S_PROCESS_ENV, ...S_INTL],
    }),
    // S11 i18n + messages: feature messages and the branding fallback are reachable by path
    scope(['src/i18n/**/*.{ts,tsx}', 'src/messages/**/*.{ts,tsx}'], [...TESTS], {
      paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, ...P_SWR, P_LUCIDE, P_TUS],
      patterns: [G_HTTP, G_CALL_API, G_FEATURE_COMPONENTS],
      syntax: [...S_ALL, ...S_UI],
    }),
    // S12 tests, harnesses, stories, .storybook: fetch, axios fakes and useEffect in decorators are fine; process.env is not
    scope([...TESTS, '.storybook/**'], [], { paths: P_NUQS_BUT_TESTING, syntax: [S_PROCESS_ENV] }),
    // S21 src/lib/log.ts: the console sink may read NODE_ENV (no S_PROCESS_ENV; S16 ignores the file)
    scope(['src/lib/log.ts'], [], {
      paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, P_LUCIDE, P_TUS],
      ...LIB_RESTRICTIONS,
      syntax: [...S_FETCH, ...S_USE_EFFECT, ...S_INTL, ...S_UI],
    }),
    // S22 the two format doors: Intl / toLocale* live here (no S_INTL)
    scope(['src/lib/i18n/format.ts', 'src/lib/i18n/format.server.ts'], [], {
      paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, P_LUCIDE, P_TUS],
      ...LIB_RESTRICTIONS,
      syntax: [...S_FETCH, S_PROCESS_ENV, ...S_USE_EFFECT, ...S_UI],
    }),
    // S23 src/config: the declared menu, routes and their gates: data only, no feature, no component
    scope([CONFIG_LAYER], [PERMISSIONS_MIRROR, ...TESTS], {
      paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, ...P_SWR, P_LUCIDE, P_TUS],
      patterns: [G_HTTP, G_CALL_API, G_ANY_FEATURE, G_COMPONENTS_FROM_LIB],
      syntax: [...S_ALL, ...S_UI],
    }),
    // S24 the catalogue mirror: the ONE home of a clean permission name (no S_PERMISSION_LITERAL, D-16)
    scope([PERMISSIONS_MIRROR], [], {
      paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, ...P_SWR, P_LUCIDE, P_TUS],
      patterns: [G_HTTP, G_CALL_API, G_ANY_FEATURE, G_COMPONENTS_FROM_LIB],
      syntax: [...S_FETCH, S_PROCESS_ENV, ...S_USE_EFFECT, ...S_INTL, ...S_UI],
    }),
    // S25 the root sources: Next 16's proxy (FE-16): reads one cookie and src/lib/auth/safe-next.ts,
    //     nothing else. `next.config.ts` and the root `*.d.ts` join it rather than taking a scope of
    //     their own (SF-5): they were in no scope at all, they are root files for the same reason
    //     `proxy.ts` is, and they want exactly these restrictions: a build config composes Next
    //     plugins and a declaration file declares types, so neither may reach a feature, import axios
    //     or read `process.env`. Keeping them here holds the scope count at `21 + FEATURES.length`,
    //     which is the number `02-coding-rules/06-frontend.md` §Layers publishes.
    scope([PROXY, ROOT_CONFIG, ROOT_DECLARATIONS], [], {
      paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, ...P_SWR, P_LUCIDE, P_TUS],
      patterns: [G_ANY_FEATURE, G_COMPONENTS_FROM_LIB],
      syntax: [...S_ALL],
    }),
    // S26 src/hocs: the FE-16 second layer: client gates over a lib hook, never the only check.
    // They compose `@/components` and `@/lib`, so `G_COMPONENTS_FROM_LIB` is absent here; a feature
    // is still out of reach, and `useEffect` stays in `lib/hooks` (the HOCs call `useSession`).
    scope([HOCS], [...TESTS], {
      paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, ...P_SWR, P_LUCIDE, P_TUS],
      patterns: [G_HTTP, G_CALL_API, G_ANY_FEATURE],
      syntax: [...S_ALL, ...S_UI],
    }),
    // S27 the tus door (ADR-0041, M9): the one importer of tus-js-client; otherwise a door of src/lib
    scope([UPLOAD_DOOR], [], {
      paths: [P_AXIOS, P_NEXT_THEMES, ...P_NUQS, ...P_SWR, P_LUCIDE],
      ...LIB_RESTRICTIONS,
      syntax: [...S_ALL, ...S_UI],
    }),
    // S13–S19: own rule ids, may overlap the scopes above (S20 = S_INTL is a constant, not an object)
    MAGIC_NUMBERS,
    REACT,
    I18N_LITERALS,
    NO_CONSOLE,
    HYGIENE,
    TEST_HYGIENE,
    A11Y,
  ];
}
