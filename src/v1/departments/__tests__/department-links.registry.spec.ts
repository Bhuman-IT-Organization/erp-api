/**
 * The links registry (D-51, D-49; the `CurrencyUsageRegistry` form): a malformed or duplicate
 * counter throws at registration, the counters come back sorted by key, there is one staff directory
 * and a second throws, none is registered before identity registers it; `DepartmentsFacade`'s two
 * registrations delegate to it through the service, and its two reads answer the picker by name then
 * id and the known ids, `[]` with no read.
 */
import { describe, expect, it } from 'vitest';
import { DepartmentsFacade } from '../facade/departments.facade.js';
import {
  DepartmentLinksRegistry,
  type DepartmentStaffDirectory,
  type DepartmentUsageCounter,
} from '../service/department-links.registry.js';
import { DepartmentsService } from '../service/departments.service.js';
import { DepartmentsTransformer } from '../service/departments.transformer.js';
import { DepartmentsValidator } from '../service/departments.validator.js';
import { asRepository, seededStore } from './fakes.js';

const counter = (overrides: Partial<DepartmentUsageCounter> = {}): DepartmentUsageCounter => ({
  key: 'staffMembers',
  module: 'identity',
  noun: 'staff member',
  count: () => Promise.resolve(0),
  ...overrides,
});

const directory = (): DepartmentStaffDirectory => ({
  listActive: () => Promise.resolve([]),
  namesOf: () => Promise.resolve(new Map()),
});

/** The real facade over the real service, the registry and the in-memory store. */
function facadeOver() {
  const repo = seededStore();
  const registry = new DepartmentLinksRegistry();
  const service = new DepartmentsService(
    new DepartmentsValidator(),
    asRepository(repo),
    new DepartmentsTransformer(),
    registry,
  );
  return { facade: new DepartmentsFacade(service), registry, repo };
}

describe('DepartmentLinksRegistry: the counters', () => {
  it('stores a counter and answers the counters sorted by key', () => {
    const registry = new DepartmentLinksRegistry();
    registry.register(counter({ key: 'taxes', module: 'taxes', noun: 'tax' }));
    registry.register(counter());
    expect(registry.counters().map((entry) => entry.key)).toEqual(['staffMembers', 'taxes']);
  });

  it('a duplicate key throws already registered', () => {
    const registry = new DepartmentLinksRegistry();
    registry.register(counter());
    expect(() => {
      registry.register(counter({ module: 'other' }));
    }).toThrow('department usage staffMembers is already registered');
    expect(registry.counters()).toHaveLength(1);
  });

  it.each([
    ['a key starting upper case', { key: 'StaffMembers' }],
    ['a key with a hyphen', { key: 'staff-members' }],
    ['a key over 40 characters', { key: `a${'b'.repeat(40)}` }],
    ['an empty key', { key: '' }],
    ['a module with upper case', { module: 'Identity' }],
    ['a module with a space', { module: 'iden tity' }],
    ['an empty noun', { noun: '' }],
    ['a noun with upper case', { noun: 'Staff member' }],
    ['a noun with punctuation', { noun: 'staff member(s)' }],
    ['a count that is not a function', { count: 1 as unknown as DepartmentUsageCounter['count'] }],
  ])('%s throws at registration', (_label, overrides) => {
    const registry = new DepartmentLinksRegistry();
    expect(() => {
      registry.register(counter(overrides));
    }).toThrow(/^department usage .*: /);
    expect(registry.counters()).toEqual([]);
  });
});

describe('DepartmentLinksRegistry: the staff directory', () => {
  it('is null before registration and the directory after', () => {
    const registry = new DepartmentLinksRegistry();
    expect(registry.staffDirectory()).toBeNull();
    const registered = directory();
    registry.setStaffDirectory(registered);
    expect(registry.staffDirectory()).toBe(registered);
  });

  it('a second directory throws already registered and keeps the first', () => {
    const registry = new DepartmentLinksRegistry();
    const first = directory();
    registry.setStaffDirectory(first);
    expect(() => {
      registry.setStaffDirectory(directory());
    }).toThrow('department staff directory is already registered');
    expect(registry.staffDirectory()).toBe(first);
  });

  it('a malformed directory throws', () => {
    const registry = new DepartmentLinksRegistry();
    expect(() => {
      registry.setStaffDirectory({ listActive: 1 } as unknown as DepartmentStaffDirectory);
    }).toThrow('department staff directory');
    expect(registry.staffDirectory()).toBeNull();
  });
});

describe('DepartmentsFacade over the registry and the store', () => {
  it('registerUsage and registerStaffDirectory delegate to the registry', () => {
    const { facade, registry } = facadeOver();
    facade.registerUsage(counter());
    const registered = directory();
    facade.registerStaffDirectory(registered);
    expect(registry.counters().map((entry) => entry.key)).toEqual(['staffMembers']);
    expect(registry.staffDirectory()).toBe(registered);
    expect(() => {
      facade.registerUsage(counter());
    }).toThrow('already registered');
    expect(() => {
      facade.registerStaffDirectory(directory());
    }).toThrow('already registered');
  });

  it('listForPicker answers { departmentId, name } by name then id, nothing else', async () => {
    const { facade } = facadeOver();
    const picker = await facade.listForPicker();
    expect(picker).toEqual([
      { departmentId: 4, name: 'Accounts' },
      { departmentId: 1, name: 'Sales' },
      { departmentId: 2, name: 'Support' },
      { departmentId: 3, name: 'Support' },
    ]);
    for (const entry of picker) expect(Object.keys(entry).sort()).toEqual(['departmentId', 'name']);
  });

  it('existingIds answers exactly the known ids; [] reads nothing', async () => {
    const { facade, repo } = facadeOver();
    expect(await facade.existingIds([])).toEqual(new Set());
    expect(repo.calls).toEqual([]);
    expect(await facade.existingIds([3, 99, 1])).toEqual(new Set([1, 3]));
    expect(repo.calls).toEqual(['findByIds']);
  });
});
