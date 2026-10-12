/**
 * The usage registry (D-41 inverted, Currencies planning answer 4; the `MailTemplateRegistry`
 * form): a malformed or duplicate counter throws at registration, the counters come back sorted by
 * key, `CurrenciesFacade.registerUsage` delegates to it, and the module that holds it imports no
 * other v1 module, so any module may register into it with no cycle.
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CurrenciesFacade } from '../facade/currencies.facade.js';
import type { CurrenciesService } from '../service/currencies.service.js';
import {
  CurrencyUsageRegistry,
  type CurrencyUsageCounter,
} from '../service/currency-usage.registry.js';

const counter = (overrides: Partial<CurrencyUsageCounter> = {}): CurrencyUsageCounter => ({
  key: 'probeRows',
  module: 'probe',
  noun: 'probe row',
  count: () => Promise.resolve(0),
  ...overrides,
});

describe('CurrencyUsageRegistry', () => {
  it('stores a counter and answers the counters sorted by key', () => {
    const registry = new CurrencyUsageRegistry();
    registry.register(counter({ key: 'shelfLabels', noun: 'shelf label' }));
    registry.register(counter());
    expect(registry.counters().map((entry) => entry.key)).toEqual(['probeRows', 'shelfLabels']);
  });

  it('a duplicate key throws already registered', () => {
    const registry = new CurrencyUsageRegistry();
    registry.register(counter());
    expect(() => {
      registry.register(counter({ module: 'other' }));
    }).toThrow('currency usage probeRows is already registered');
    expect(registry.counters()).toHaveLength(1);
  });

  it.each([
    ['a key starting upper case', { key: 'ProbeRows' }],
    ['a key with a hyphen', { key: 'probe-rows' }],
    ['a key over 40 characters', { key: `a${'b'.repeat(40)}` }],
    ['an empty key', { key: '' }],
    ['a module with upper case', { module: 'Probe' }],
    ['a module with a space', { module: 'ware house' }],
    ['an empty noun', { noun: '' }],
    ['a noun with upper case', { noun: 'Probe row' }],
    ['a noun with punctuation', { noun: 'probe row(s)' }],
    ['a count that is not a function', { count: 1 as unknown as CurrencyUsageCounter['count'] }],
  ])('%s throws at registration', (_label, overrides) => {
    const registry = new CurrencyUsageRegistry();
    expect(() => {
      registry.register(counter(overrides));
    }).toThrow(/^currency usage .*: /);
    expect(registry.counters()).toEqual([]);
  });

  it('CurrenciesFacade.registerUsage delegates to the service, which registers it', () => {
    const registry = new CurrencyUsageRegistry();
    const service = {
      registerUsage: (entry: CurrencyUsageCounter) => {
        registry.register(entry);
      },
    } as unknown as CurrenciesService;
    const facade = new CurrenciesFacade(service);
    facade.registerUsage(counter());
    expect(registry.counters().map((entry) => entry.key)).toEqual(['probeRows']);
    expect(() => {
      facade.registerUsage(counter());
    }).toThrow('already registered');
  });
});

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V1_ROOT = resolve(MODULE_ROOT, '..');

/** Every `.ts` file under `root` outside `__tests__`, as absolute paths. */
function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !relative(root, path).split(sep).includes('__tests__'));
}

/** Every module specifier of a source: `from '...'`, `import '...'` and `import('...')`. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)'([^']+)'/g)].map(
    (match) => match[1] ?? '',
  );
}

/**
 * The imports of the module under `moduleRoot` that resolve under `v1Root` but outside the module:
 * one or two levels up into another module's folder is caught, the module's own `../model/` and
 * `../service/` are not (the intent of the checker's `(?!currencies)` pattern, resolved instead of
 * matched).
 */
function crossModuleImports(moduleRoot: string, v1Root: string): string[] {
  return sourceFiles(moduleRoot).flatMap((file) =>
    specifiers(readFileSync(file, 'utf8'))
      .filter((specifier) => specifier.startsWith('.'))
      .map((specifier) => resolve(dirname(file), specifier))
      .filter((target) => {
        const inV1 = !relative(v1Root, target).startsWith('..');
        const inModule = !relative(moduleRoot, target).startsWith('..');
        return inV1 && !inModule;
      })
      .map((target) => `${relative(moduleRoot, file)} -> ${relative(v1Root, target)}`),
  );
}

describe('the module boundary (answer 4)', () => {
  it('currencies imports no other v1 module', () => {
    expect(crossModuleImports(MODULE_ROOT, V1_ROOT)).toEqual([]);

    // The same check on a temporary copy with one probe line: it must fail there.
    const scratch = mkdtempSync(join(tmpdir(), 'currencies-boundary-'));
    try {
      const copy = join(scratch, 'v1', 'currencies');
      cpSync(MODULE_ROOT, copy, { recursive: true });
      writeFileSync(
        join(copy, 'service', 'probe.ts'),
        "import '../../taxes/index.js';\nexport {};\n",
      );
      expect(crossModuleImports(copy, join(scratch, 'v1'))).toEqual([
        `service${sep}probe.ts -> taxes${sep}index.js`,
      ]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
