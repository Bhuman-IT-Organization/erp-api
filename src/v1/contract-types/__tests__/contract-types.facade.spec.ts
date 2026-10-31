/**
 * ContractTypesFacade through the module: the read-only lookups the contracts and other
 * migrations will read. `listAll` is the name ascending, then the id (the order
 * Perfex's pickers read); `findByIds` answers the ids in the order given, each once, absent ids
 * skipped; `findById` answers `null` when absent. Each answers `ContractType { id, name }`, never the
 * wire DTO, and none asserts the administrator flag: it is a module-to-module read with no actor.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContractTypesFacade } from '../facade/contract-types.facade.js';
import {
  createContractTypesTestApp,
  type ContractTypesTestApp,
} from './create-contract-types-test-app.js';

describe('ContractTypesFacade', () => {
  let ctx: ContractTypesTestApp;
  let facade: ContractTypesFacade;

  beforeAll(async () => {
    ctx = await createContractTypesTestApp();
    facade = ctx.moduleRef.get(ContractTypesFacade);
    // Ids 4 to 9: `Head Office` a third time, so the id breaks the tie among three.
    for (const name of ['Four', 'Five', 'Head Office', 'Seven', 'Eight', 'Nine']) {
      await ctx.repo.create({ name });
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('resolves through the module with every layer injected and describes the module', () => {
    expect(facade.describe()).toEqual({ module: 'contract-types', version: 1 });
  });

  it('listAll answers every contract type, the name ascending, then the id (equal names by id)', async () => {
    expect((await facade.listAll()).map((item) => [item.id, item.name])).toEqual([
      [8, 'Eight'],
      [5, 'Five'],
      [4, 'Four'],
      [1, 'Head Office'],
      [3, 'Head Office'],
      [6, 'Head Office'],
      [9, 'Nine'],
      [7, 'Seven'],
      [2, 'Warehouse'],
    ]);
  });

  it('findByIds([9, 7, 404, 7]) answers 9 then 7, once each, the absent id skipped', async () => {
    expect(await facade.findByIds([9, 7, 404, 7])).toEqual([
      { id: 9, name: 'Nine' },
      { id: 7, name: 'Seven' },
    ]);
  });

  it('findById answers { id, name } (never the wire DTO, never created_by), or null when absent', async () => {
    expect(await facade.findById(2)).toEqual({ id: 2, name: 'Warehouse' });
    expect(await facade.findById(404)).toBeNull();
  });

  it('no facade read asserts the administrator flag: none takes an actor', () => {
    const methods = ContractTypesFacade.prototype as unknown as Record<string, unknown>;
    for (const [name, arity] of [
      ['findById', 1],
      ['listAll', 0],
      ['findByIds', 1],
    ] as const) {
      const method = methods[name];
      expect(typeof method, name).toBe('function');
      if (typeof method !== 'function') continue;
      expect(String(method), name).not.toContain('assertAdministrator');
      expect(method.length, name).toBe(arity);
    }
  });
});
