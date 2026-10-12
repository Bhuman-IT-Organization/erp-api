/**
 * TaxesFacade through the module: the read-only lookups. `listAll` is the rate ascending, then the
 * id; `findByIds` answers the ids in the order given, each once, absent ids skipped; `findById`
 * answers `null` when absent. Each answers `Tax { id, name, rate }`, and none asserts the
 * administrator flag: it is a module-to-module read with no actor.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TaxesFacade } from '../facade/taxes.facade.js';
import { createTaxesTestApp, type TaxesTestApp } from './create-taxes-test-app.js';

describe('TaxesFacade', () => {
  let ctx: TaxesTestApp;
  let facade: TaxesFacade;

  beforeAll(async () => {
    ctx = await createTaxesTestApp();
    facade = ctx.moduleRef.get(TaxesFacade);
    // Ids 4 to 9: two rates equal to a seeded one, so the id breaks the tie.
    for (const [name, taxrate] of [
      ['Four', '10.00'],
      ['Five', '0.50'],
      ['Six', '5.00'],
      ['Seven', '7.00'],
      ['Eight', '8.00'],
      ['Nine', '9.00'],
    ] as const) {
      await ctx.repo.create({ name, taxrate });
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('resolves through the module with every layer injected and describes the module', () => {
    expect(facade.describe()).toEqual({ module: 'taxes', version: 1 });
  });

  it('listAll answers every tax, the rate ascending, then the id', async () => {
    expect((await facade.listAll()).map((tax) => [tax.id, tax.rate])).toEqual([
      [5, '0.50'],
      [2, '5.00'],
      [6, '5.00'],
      [7, '7.00'],
      [8, '8.00'],
      [9, '9.00'],
      [1, '10.00'],
      [4, '10.00'],
      [3, '100.00'],
    ]);
  });

  it('findByIds([9, 7, 404, 7]) answers 9 then 7, once each, the absent id skipped', async () => {
    expect(await facade.findByIds([9, 7, 404, 7])).toEqual([
      { id: 9, name: 'Nine', rate: '9.00' },
      { id: 7, name: 'Seven', rate: '7.00' },
    ]);
  });

  it('findById answers { id, name, rate } (never the wire DTO), or null when absent', async () => {
    expect(await facade.findById(2)).toEqual({ id: 2, name: 'Reduced', rate: '5.00' });
    expect(await facade.findById(404)).toBeNull();
  });

  it('no facade read asserts the administrator flag: none takes an actor', () => {
    const methods = TaxesFacade.prototype as unknown as Record<string, unknown>;
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
