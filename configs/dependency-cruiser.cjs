// check:cycles (01-typescript-and-lint TS-15): no circular dependency, type-only imports included. Shared by erp-api and erp-web (configs/).
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'break the cycle: move the shared part into a third module (TS-15)',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // ^src/shared/db/generated/: Prisma's generated client, gitignored and rebuilt on install (not team code).
    exclude: {
      path: '(^|/)(__tests__|configs)/|^src/shared/db/generated/|\\.(spec|test|stories)\\.tsx?$',
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
