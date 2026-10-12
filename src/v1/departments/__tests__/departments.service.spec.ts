/**
 * DepartmentsService over the in-memory store and the real registry: administrators only before any
 * read (D-06, D-45); the reads answer the register's counts, the registered counters and the names
 * of the manager (the staff directory) and the parent, and fail closed; no read answers a mailbox
 * key (D-47); the service has no write use case (`tbldepartments` is Perfex's); the facade paths
 * assert nothing.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { DepartmentRow } from '../model/departments.model.js';
import { DepartmentLinksRegistry } from '../service/department-links.registry.js';
import { DepartmentsService } from '../service/departments.service.js';
import { DepartmentsTransformer, NO_DEPARTMENT_USAGE } from '../service/departments.transformer.js';
import { DepartmentsValidator } from '../service/departments.validator.js';
import {
  FakeStaffDirectory,
  SettableUsageCounter,
  TEST_NOW,
} from './create-departments-test-app.js';
import { asRepository, SEED_DEPARTMENTS, seededStore } from './fakes.js';

const EXPIRY_S = 4_102_444_800;
const ADMIN_ONLY = 'departments are managed by administrators only';

/** The eight ticket-mailbox columns Node never reads (D-47); the poisoned row carries each. */
const MAILBOX_KEYS = [
  'imap_username',
  'email',
  'email_from_header',
  'host',
  'password',
  'encryption',
  'folder',
  'delete_after_import',
] as const;
const SENTINEL = 'zz-mailbox-sentinel';

function actor(isAdmin: boolean): AuthenticatedUser {
  return {
    staffId: isAdmin ? 1 : 2,
    sessionId: 'sid',
    jti: 'jti',
    isAdmin,
    roleId: null,
    tokenVersion: 0,
    expiresAt: EXPIRY_S,
  };
}

const ADMIN = actor(true);
const MEMBER = actor(false);

/** A row object as a careless read would hand it over: the six columns plus every mailbox key. */
function poisoned(row: DepartmentRow): DepartmentRow {
  return {
    ...row,
    ...Object.fromEntries(MAILBOX_KEYS.map((key) => [key, SENTINEL])),
  };
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

function build(options: { readonly directory?: boolean } = {}) {
  const repo = seededStore();
  const registry = new DepartmentLinksRegistry();
  const counter = new SettableUsageCounter();
  const directory = new FakeStaffDirectory();
  registry.register({
    key: 'staffMembers',
    module: 'identity',
    noun: 'staff member',
    count: (id) => counter.count(id),
  });
  if (options.directory !== false) registry.setStaffDirectory(directory);
  const service = new DepartmentsService(
    new DepartmentsValidator(),
    asRepository(repo),
    new DepartmentsTransformer(),
    registry,
  );
  service.now = () => TEST_NOW;
  return { service, repo, counter, directory };
}

describe('DepartmentsService: administrators only (D-06, D-45)', () => {
  const calls: readonly [string, (service: DepartmentsService) => Promise<unknown>][] = [
    ['list', (service) => service.list(MEMBER, {})],
    ['exportCsv', (service) => service.exportCsv(MEMBER, {})],
    ['managers', (service) => service.managers(MEMBER)],
    ['options', (service) => service.options(MEMBER)],
    ['get', (service) => service.get(MEMBER, { id: '1' })],
  ];

  it.each(calls)(
    '%s refuses a non-administrator with ERP-AUTH-0005 before any read, counter or directory call',
    async (_name, call) => {
      const { service, repo, counter, directory } = build();
      const error = await refusal(call(service));
      expect(error.code).toBe('ERP-AUTH-0005');
      expect(error.message).toBe(ADMIN_ONLY);
      expect(repo.calls).toEqual([]);
      expect(counter.asked).toEqual([]);
      expect(directory.calls).toEqual([]);
    },
  );

  it('has no write use case: tbldepartments is written by Perfex only', () => {
    const { service } = build();
    for (const name of ['create', 'update', 'remove']) {
      expect(name in service, name).toBe(false);
    }
  });
});

describe('DepartmentsService: the reads', () => {
  it('list answers the page in Perfex order with counts, staff counts and both names', async () => {
    const { service, repo, counter } = build();
    repo.usage.set(1, { ...NO_DEPARTMENT_USAGE, tickets: 2 });
    counter.answers.set(2, 5);
    const list = await service.list(ADMIN, {});
    expect(list.data.map((row) => row.id)).toEqual(['4', '1', '2', '3']);
    const [accounts, sales, support, child] = list.data;
    expect(accounts).toMatchObject({
      calendarId: '',
      managerId: '12',
      managerName: 'Ada Lovelace',
    });
    expect(sales).toMatchObject({ managerName: 'Grace Hopper', usage: { tickets: 2 } });
    expect(support?.registeredUsage).toEqual({ staffMembers: 5 });
    expect(child).toMatchObject({ parentId: '2', parentName: 'Support' });
    expect(counter.asked).toEqual([4, 1, 2, 3]);
  });

  it('a stored manager the directory no longer knows reads with a null name', async () => {
    const { service, directory } = build();
    directory.members = [];
    expect(await service.get(ADMIN, { id: '1' })).toMatchObject({
      managerId: '11',
      managerName: null,
    });
  });

  it('a deactivated stored manager still reads with their name', async () => {
    const { service, directory } = build();
    directory.members = [{ staffId: 12, name: 'Ada Lovelace' }];
    directory.inactive.set(11, 'Grace Hopper');
    expect(await service.get(ADMIN, { id: '1' })).toMatchObject({
      managerId: '11',
      managerName: 'Grace Hopper',
    });
    expect(directory.calls).not.toContain('listActive');
  });

  it('get answers ERP-CORE-0004 for a missing id', async () => {
    const { service } = build();
    await expect(service.get(ADMIN, { id: '99' })).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });
  });

  it('fails a read closed when a counter rejects or answers a non-count', async () => {
    const failing = build();
    failing.counter.error = new Error('identity down');
    await expect(failing.service.list(ADMIN, {})).rejects.toThrow('identity down');
    const wrong = build();
    wrong.counter.answers.set(1, -1);
    await expect(wrong.service.get(ADMIN, { id: '1' })).rejects.toThrow('other than a count');
  });

  it('fails a read closed when a manager needs a name and no directory is registered', async () => {
    const { service } = build({ directory: false });
    await expect(service.get(ADMIN, { id: '1' })).rejects.toMatchObject({
      code: 'ERP-INTERNAL-0001',
    });
    expect(await service.get(ADMIN, { id: '2' })).toMatchObject({ managerId: null });
  });

  it('a failing usage read rejects the list', async () => {
    const { service, repo } = build();
    repo.usageError = new Error('probe failed');
    await expect(service.list(ADMIN, {})).rejects.toThrow('probe failed');
  });

  it('managers answers the directory active members as { id, name }, in the directory order', async () => {
    const { service, repo, counter } = build();
    expect(await service.managers(ADMIN)).toEqual({
      data: [
        { id: '12', name: 'Ada Lovelace' },
        { id: '11', name: 'Grace Hopper' },
      ],
    });
    expect(repo.calls).toEqual([]);
    expect(counter.asked).toEqual([]);
  });

  it('managers fails closed with ERP-INTERNAL-0001 when no directory is registered', async () => {
    const { service } = build({ directory: false });
    await expect(service.managers(ADMIN)).rejects.toMatchObject({ code: 'ERP-INTERNAL-0001' });
  });

  it('options answers every department by name then id with its parent, and reads no count', async () => {
    const { service, repo, counter } = build();
    expect(await service.options(ADMIN)).toEqual({
      data: [
        { id: '4', name: 'Accounts', parentId: null },
        { id: '1', name: 'Sales', parentId: null },
        { id: '2', name: 'Support', parentId: null },
        { id: '3', name: 'Support', parentId: '2' },
      ],
    });
    expect(repo.calls).toEqual(['findAll']);
    expect(counter.asked).toEqual([]);
  });
});

describe('DepartmentsService: no mailbox column on any read (D-47)', () => {
  it('rows carrying every mailbox key answer none of them, on the list, a record or a picker', async () => {
    const { service, repo } = build();
    repo.seed(SEED_DEPARTMENTS.map(poisoned));
    const everything = JSON.stringify([
      await service.list(ADMIN, {}),
      await service.get(ADMIN, { id: '1' }),
      await service.options(ADMIN),
      await service.listForPicker(),
      (await service.exportCsv(ADMIN, { format: 'print' })).body,
    ]);
    for (const key of MAILBOX_KEYS) expect(everything, key).not.toContain(key);
    expect(everything).not.toContain(SENTINEL);
  });
});

describe('DepartmentsService: the export and the facade paths', () => {
  it('the export reads no count and refuses a key', async () => {
    const { service, repo, counter } = build();
    const file = await service.exportCsv(ADMIN, {});
    expect(file.body).toEqual(expect.stringContaining('Accounts'));
    expect(repo.calls).not.toContain('usageByDepartment');
    expect(counter.asked).toEqual([]);
    await expect(service.exportCsv(ADMIN, { key: '1' })).rejects.toBeInstanceOf(AppError);
  });

  it('listForPicker and existingIds read the store; existingIds([]) reads nothing', async () => {
    const { service, repo } = build();
    expect((await service.listForPicker()).map((entry) => entry.departmentId)).toEqual([
      4, 1, 2, 3,
    ]);
    repo.calls.length = 0;
    expect(await service.existingIds([])).toEqual(new Set());
    expect(repo.calls).toEqual([]);
    expect(await service.existingIds([1, 99])).toEqual(new Set([1]));
  });
});
