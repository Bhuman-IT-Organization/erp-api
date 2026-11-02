import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedEquipmentDepreciationsFacade } from '../facade/fixed-equipment-depreciations.facade.js';
import {
  createFixedEquipmentDepreciationsTestApp,
  type FixedEquipmentDepreciationsTestApp,
} from './create-fixed-equipment-depreciations-test-app.js';
import { SEED_FIXED_EQUIPMENT_DEPRECIATIONS } from './fakes.js';

describe('FixedEquipmentDepreciationsFacade', () => {
  let context: FixedEquipmentDepreciationsTestApp;
  let facade: FixedEquipmentDepreciationsFacade;

  beforeAll(async () => {
    context = await createFixedEquipmentDepreciationsTestApp();
    facade = context.moduleRef.get(FixedEquipmentDepreciationsFacade);
  });
  afterAll(async () => {
    await context.close();
  });

  it('resolves through the module and describes its version', () => {
    expect(facade.describe()).toEqual({ module: 'fixed-equipment-depreciations', version: 1 });
  });

  it('listAll answers every depreciation, the name ascending, then the id', async () => {
    const expected = [...SEED_FIXED_EQUIPMENT_DEPRECIATIONS]
      .sort((x, y) => x.name.localeCompare(y.name) || x.id - y.id)
      .map((row) => row.id);
    expect((await facade.listAll()).map((row) => row.id)).toEqual(expected);
  });

  it('findById answers the depreciation, or null when absent', async () => {
    const first = SEED_FIXED_EQUIPMENT_DEPRECIATIONS[0];
    if (first === undefined) throw new Error('the fake has no seeded depreciation');
    expect(await facade.findById(first.id)).toEqual(first);
    expect(await facade.findById(404_404)).toBeNull();
  });

  it('does not require an actor for its module-to-module reads', () => {
    const methods = FixedEquipmentDepreciationsFacade.prototype as unknown as Record<
      string,
      unknown
    >;
    for (const [name, arity] of [
      ['findById', 1],
      ['listAll', 0],
    ] as const) {
      const method = methods[name];
      expect(typeof method, name).toBe('function');
      if (typeof method !== 'function') continue;
      expect(method.length, name).toBe(arity);
    }
  });
});
