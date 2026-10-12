/**
 * PaymentModesFacade through the module: the read-only lookups the invoices and payments, expenses
 * and purchase migrations will read. `listAll` is the name ascending, then the id; `findByIds`
 * answers the ids in the order given, each once, absent ids skipped; `findById` answers `null` when
 * absent. Each answers `PaymentMode { id, name, active, invoicesOnly, expensesOnly,
 * selectedByDefault, showOnPdf }` with every flag a boolean, never the wire DTO or the description,
 * and none asserts the administrator flag: it is a module-to-module read with no actor. Online
 * gateways are not merged in (D-32): the caller merges its own.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaymentModesFacade } from '../facade/payment-modes.facade.js';
import {
  createPaymentModesTestApp,
  type PaymentModesTestApp,
} from './create-payment-modes-test-app.js';

describe('PaymentModesFacade', () => {
  let ctx: PaymentModesTestApp;
  let facade: PaymentModesFacade;

  beforeAll(async () => {
    ctx = await createPaymentModesTestApp();
    facade = ctx.moduleRef.get(PaymentModesFacade);
    // Ids 4 to 9: `Bank` a third time, so the id breaks the tie among three.
    for (const name of ['Four', 'Five', 'Bank', 'Seven', 'Eight', 'Nine']) {
      await ctx.repo.create({
        name,
        description: '',
        active: true,
        showOnPdf: 0,
        selectedByDefault: 0,
        invoicesOnly: 0,
        expensesOnly: 0,
      });
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('resolves through the module with every layer injected and describes the module', () => {
    expect(facade.describe()).toEqual({ module: 'payment-modes', version: 1 });
  });

  it('listAll answers every payment mode, the name ascending, then the id (equal names by id), every flag a boolean', async () => {
    const all = await facade.listAll();
    expect(all.map((mode) => [mode.id, mode.name])).toEqual([
      [1, 'Bank'],
      [3, 'Bank'],
      [6, 'Bank'],
      [2, 'Cash'],
      [8, 'Eight'],
      [5, 'Five'],
      [4, 'Four'],
      [9, 'Nine'],
      [7, 'Seven'],
    ]);
    for (const mode of all) {
      for (const flag of [
        mode.active,
        mode.invoicesOnly,
        mode.expensesOnly,
        mode.selectedByDefault,
        mode.showOnPdf,
      ]) {
        expect(typeof flag).toBe('boolean');
      }
    }
  });

  it('findByIds([9, 7, 404, 7]) answers 9 then 7, once each, the absent id skipped', async () => {
    expect((await facade.findByIds([9, 7, 404, 7])).map((mode) => [mode.id, mode.name])).toEqual([
      [9, 'Nine'],
      [7, 'Seven'],
    ]);
  });

  it('findById answers the PaymentMode shape (never the description or the DTO), or null when absent', async () => {
    expect(await facade.findById(3)).toEqual({
      id: 3,
      name: 'Bank',
      active: true,
      invoicesOnly: true,
      expensesOnly: false,
      selectedByDefault: false,
      showOnPdf: false,
    });
    expect(await facade.findById(404)).toBeNull();
  });

  it('no facade read asserts the administrator flag: none takes an actor', () => {
    const methods = PaymentModesFacade.prototype as unknown as Record<string, unknown>;
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
