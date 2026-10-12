import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdentityFacade } from '../facade/identity.facade.js';
import { createIdentityTestApp, type IdentityTestApp } from './create-identity-test-app.js';
import { member } from './fakes.js';

describe('IdentityFacade', () => {
  let ctx: IdentityTestApp;

  beforeAll(async () => {
    ctx = await createIdentityTestApp();
    // Invented members beside the seed: two active with names that sort before the seed's, and an
    // inactive one; 7 and 8 share a first name so the last name decides, 9 and 7 share both.
    ctx.repo.members.push(
      member({ staffId: 9, firstName: 'Ann', lastName: 'Zed' }),
      member({ staffId: 7, firstName: 'Ann', lastName: 'Zed' }),
      member({ staffId: 8, firstName: 'Ann', lastName: 'Bee', active: false }),
      member({ staffId: 6, firstName: 'Ann', lastName: 'Ash' }),
    );
  });

  afterAll(async () => {
    await ctx.close();
  });

  const facade = () => ctx.moduleRef.get(IdentityFacade);

  it('resolves through the module with every layer injected and describes the module', () => {
    expect(facade().describe()).toEqual({
      module: 'identity',
      version: 1,
    });
  });

  it('listActiveMembers answers only active members, by first name, last name, then id, each named "first last"', async () => {
    const active = await facade().listActiveMembers();
    expect(active.map((row) => row.staffId)).toEqual([6, 7, 9, 1, 2, 4]);
    expect(active[0]).toEqual({ staffId: 6, name: 'Ann Ash' });
    expect(active.find((row) => row.staffId === 2)).toEqual({ staffId: 2, name: 'Seed2 Member' });
    expect(active.some((row) => row.staffId === 3 || row.staffId === 8)).toBe(false);
  });

  it('namesOf answers every known id whatever its state and omits an unknown one', async () => {
    expect(await facade().namesOf([7, 8, 999])).toEqual(
      new Map([
        [7, 'Ann Zed'],
        [8, 'Ann Bee'],
      ]),
    );
  });

  it('namesOf([]) answers an empty map without a read', async () => {
    const before = ctx.repo.staffNameReads;
    expect(await facade().namesOf([])).toEqual(new Map());
    expect(ctx.repo.staffNameReads).toBe(before);
  });

  it('contactOf answers the address, the locale and the active flag, and null for an unknown id', async () => {
    ctx.repo.members.push(
      member({ staffId: 12, email: 'user@example.test', defaultLanguage: 'arabic', active: false }),
    );
    expect(await facade().contactOf(12)).toEqual({
      email: 'user@example.test',
      locale: 'ar',
      active: false,
    });
    expect(await facade().contactOf(9999)).toBeNull();
  });
});
