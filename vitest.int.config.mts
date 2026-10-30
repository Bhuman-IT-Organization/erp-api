import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests: need DATABASE_URL (loaded by `yarn test:int` from ../erp-infra/env/local/api.host.env)
// and the legacy-local stack running at 127.0.0.1:33061.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: { target: 'es2022', transform: { legacyDecorator: true, decoratorMetadata: true } },
    }),
  ],
  test: {
    include: ['src/**/*.int.spec.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    environment: 'node',
    watch: false,
    testTimeout: 30000,
    fileParallelism: false,
  },
});
