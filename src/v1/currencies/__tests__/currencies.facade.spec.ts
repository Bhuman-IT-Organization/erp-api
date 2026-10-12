/**
 * CurrenciesFacade resolved through the module (the test app's wiring, the repository faked): the
 * two reads other modules call (D-44) and the usage registration (D-41 inverted). No facade method
 * asserts the administrator flag: a module-to-module call has no actor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CurrenciesFacade } from '../facade/currencies.facade.js';
import { CurrenciesService } from '../service/currencies.service.js';
import { createCurrenciesTestApp, type CurrenciesTestApp } from './create-currencies-test-app.js';

describe('CurrenciesFacade', () => {
  let testApp: CurrenciesTestApp;
  let facade: CurrenciesFacade;

  beforeAll(async () => {
    testApp = await createCurrenciesTestApp();
    facade = testApp.moduleRef.get(CurrenciesFacade);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('describes the module', () => {
    expect(facade.describe()).toEqual({ module: 'currencies', version: 1 });
  });

  it('listAll answers every currency, the id ascending, isBase a boolean', async () => {
    const all = await facade.listAll();
    expect(all.map((currency) => currency.id)).toEqual([1, 2, 3, 4]);
    expect(all.map((currency) => currency.isBase)).toEqual([true, false, false, false]);
    expect(Object.keys(all[0] ?? {}).sort()).toEqual(
      [
        'decimalSeparator',
        'id',
        'isBase',
        'name',
        'placement',
        'symbol',
        'thousandSeparator',
      ].sort(),
    );
  });

  it('baseCurrency answers the first isdefault row by id, or null when none is set', async () => {
    expect((await facade.baseCurrency())?.id).toBe(1);
    const repo = testApp.repo;
    const before = repo.all();
    repo.seed(before.map((row) => ({ ...row, isBase: false })));
    expect(await facade.baseCurrency()).toBeNull();
    repo.seed(before);
  });

  it('registerUsage refuses a second counter under a registered key (the test app registered probeRows)', () => {
    expect(() => {
      facade.registerUsage({
        key: 'probeRows',
        module: 'probe',
        noun: 'probe row',
        count: () => Promise.resolve(0),
      });
    }).toThrow('currency usage probeRows is already registered');
  });

  it('registerUsage stores a counter the service then reads for every row', async () => {
    facade.registerUsage({
      key: 'shelfLabels',
      module: 'probe',
      noun: 'shelf label',
      count: (id) => Promise.resolve(id === 4 ? 2 : 0),
    });
    const service = testApp.moduleRef.get(CurrenciesService);
    const admin = {
      staffId: 1,
      sessionId: 's',
      jti: 'j',
      isAdmin: true,
      roleId: null,
      tokenVersion: 0,
      expiresAt: 4_102_444_800,
    };
    const record = await service.get(admin, { id: '4' });
    expect(record.registeredUsage).toEqual({ probeRows: 0, shelfLabels: 2 });
  });

  it('no facade method asserts the administrator flag: a module-to-module call has no actor', () => {
    for (const name of Object.getOwnPropertyNames(CurrenciesFacade.prototype)) {
      const method = (CurrenciesFacade.prototype as unknown as Record<string, unknown>)[name];
      expect(String(method), name).not.toContain('assertAdministrator');
    }
    for (const name of ['listAll', 'baseCurrency', 'registerUsage']) {
      const method = (CurrenciesService.prototype as unknown as Record<string, unknown>)[name];
      expect(String(method), name).not.toContain('assertAdministrator');
    }
  });
});
