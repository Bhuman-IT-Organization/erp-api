/**
 * What identity registers with `DepartmentsFacade` from its own `onModuleInit` (D-51, D-49, D-55):
 * exactly one usage counter (`staffMembers`, module `identity`, noun `staff member`), which counts
 * the DISTINCT staff members holding a department in `tblstaff_departments` and never writes, and
 * exactly one staff directory, which answers what `IdentityFacade.listActiveMembers` and `namesOf`
 * answer. Departments never imports identity: identity hands both in.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdentityFacade } from '../facade/identity.facade.js';
import { createIdentityTestApp, type IdentityTestApp } from './create-identity-test-app.js';

describe('IdentityDepartmentLinks (registered at init)', () => {
  let ctx: IdentityTestApp;

  beforeAll(async () => {
    ctx = await createIdentityTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('registers exactly one counter and one staff directory at init', () => {
    expect(
      ctx.departments.registered.map(({ key, module, noun }) => ({ key, module, noun })),
    ).toEqual([{ key: 'staffMembers', module: 'identity', noun: 'staff member' }]);
    expect(ctx.departments.directories).toHaveLength(1);
    expect(ctx.departments.registry.counters().map((counter) => counter.key)).toEqual([
      'staffMembers',
    ]);
  });

  it('the counter answers the distinct staff members of a department, and writes nothing', async () => {
    const departmentIds = ctx.repo.departmentIds;
    for (const key of Object.keys(departmentIds)) departmentIds[Number(key)] = [];
    // Staff 1 holds departments 3 and 4 and a duplicate row of 3; staff 2 holds 3.
    departmentIds[1] = [3, 4, 3];
    departmentIds[2] = [3];
    const before = JSON.stringify(departmentIds);
    const [counter] = ctx.departments.registered;
    expect(counter).toBeDefined();
    expect(await counter?.count(3)).toBe(2);
    expect(await counter?.count(4)).toBe(1);
    expect(await counter?.count(99)).toBe(0);
    expect(JSON.stringify(departmentIds)).toBe(before);
    expect(ctx.repo.departmentWrites).toEqual([]);
  });

  it("the directory answers what IdentityFacade's listActiveMembers and namesOf answer", async () => {
    const [directory] = ctx.departments.directories;
    const facade = ctx.moduleRef.get(IdentityFacade);
    const active = await facade.listActiveMembers();
    expect(await directory?.listActive()).toEqual(
      active.map((member) => ({ staffId: member.staffId, name: member.name })),
    );
    expect(active.length).toBeGreaterThan(0);
    const ids = [...active.map((member) => member.staffId), 404];
    expect(await directory?.namesOf(ids)).toEqual(await facade.namesOf(ids));
  });
});
