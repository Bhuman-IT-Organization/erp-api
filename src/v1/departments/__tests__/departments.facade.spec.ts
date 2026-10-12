/**
 * DepartmentsFacade resolved through the module (the test app's wiring, the repository faked): the
 * two reads identity calls (D-55), the counter registration (D-51) and the staff directory (D-49),
 * each proven to reach the service that reads it. No facade method asserts the administrator flag: a
 * module-to-module call has no actor.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { DepartmentsFacade } from '../facade/departments.facade.js';
import { DepartmentsService } from '../service/departments.service.js';
import {
  createDepartmentsTestApp,
  type DepartmentsTestApp,
} from './create-departments-test-app.js';
import { SEED_PICKER } from './fakes.js';

const ADMIN: AuthenticatedUser = {
  staffId: 1,
  sessionId: 's',
  jti: 'j',
  isAdmin: true,
  roleId: null,
  tokenVersion: 0,
  expiresAt: 4_102_444_800,
};

describe('DepartmentsFacade', () => {
  let ctx: DepartmentsTestApp;
  let facade: DepartmentsFacade;

  beforeAll(async () => {
    ctx = await createDepartmentsTestApp();
    facade = ctx.moduleRef.get(DepartmentsFacade);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('resolves through the module with every layer injected and describes the module', () => {
    expect(facade.describe()).toEqual({ module: 'departments', version: 1 });
  });

  it('listForPicker answers every department by name then id, each exactly { departmentId, name }', async () => {
    const picker = await facade.listForPicker();
    expect(picker).toEqual(SEED_PICKER);
    expect(picker.map((entry) => entry.departmentId)).toEqual([4, 1, 2, 3]);
    for (const entry of picker) expect(Object.keys(entry).sort()).toEqual(['departmentId', 'name']);
  });

  it('existingIds answers exactly the known ids; [] answers an empty set with no read', async () => {
    expect(await facade.existingIds([2, 404, 4, 2])).toEqual(new Set([2, 4]));
    ctx.repo.calls.length = 0;
    expect(await facade.existingIds([])).toEqual(new Set());
    expect(ctx.repo.calls).toEqual([]);
  });

  it('registerUsage refuses a second counter under a registered key (the test app registered staffMembers)', () => {
    expect(() => {
      facade.registerUsage({
        key: 'staffMembers',
        module: 'identity',
        noun: 'staff member',
        count: () => Promise.resolve(0),
      });
    }).toThrow('department usage staffMembers is already registered');
  });

  it('registerUsage stores a counter the service then reads for a record', async () => {
    facade.registerUsage({
      key: 'zzProbes',
      module: 'probe',
      noun: 'probe',
      count: (id) => Promise.resolve(id === 4 ? 2 : 0),
    });
    const record = await ctx.moduleRef.get(DepartmentsService).get(ADMIN, { id: '4' });
    expect(record.registeredUsage).toEqual({ staffMembers: 0, zzProbes: 2 });
  });

  it('registerStaffDirectory stores the directory the managers read answers, and refuses a second', async () => {
    ctx.directory.members = [{ staffId: 7, name: 'Katherine Johnson' }];
    const managers = await ctx.moduleRef.get(DepartmentsService).managers(ADMIN);
    expect(managers).toEqual({ data: [{ id: '7', name: 'Katherine Johnson' }] });
    expect(() => {
      facade.registerStaffDirectory(ctx.directory);
    }).toThrow('department staff directory is already registered');
  });

  it('no facade method asserts the administrator flag: a module-to-module call has no actor', () => {
    for (const name of Object.getOwnPropertyNames(DepartmentsFacade.prototype)) {
      const method = (DepartmentsFacade.prototype as unknown as Record<string, unknown>)[name];
      expect(String(method), name).not.toContain('assertAdministrator');
    }
    for (const name of [
      'registerUsage',
      'registerStaffDirectory',
      'listForPicker',
      'existingIds',
    ]) {
      const method = (DepartmentsService.prototype as unknown as Record<string, unknown>)[name];
      expect(typeof method, name).toBe('function');
      expect(String(method), name).not.toContain('assertAdministrator');
    }
  });
});
