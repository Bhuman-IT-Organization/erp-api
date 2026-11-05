import { describe, expect, it } from 'vitest';

import { FIXED_EQUIPMENT_SETTINGS_CODES } from '../src/fixed-equipment-settings.js';
import { PERMISSIONS } from '../src/permissions.catalogue.js';

const { accessories, assets, consumables, licenses, settingDepreciation } =
  PERMISSIONS.fixedEquipment;

describe('FIXED_EQUIPMENT_SETTINGS_CODES', () => {
  it('the Depreciations tab is its own settings group first, then the four item groups', () => {
    const groups = [settingDepreciation, assets, licenses, accessories, consumables];
    expect(FIXED_EQUIPMENT_SETTINGS_CODES.depreciation).toEqual({
      read: { all: groups.map((g) => g.view), own: groups.map((g) => g.viewOwn) },
      create: groups.map((g) => g.create),
      edit: groups.map((g) => g.edit),
      delete: groups.map((g) => g.delete),
    });
  });

  it.each([
    ['category', 'settingCategory'],
    ['customField', 'settingCustomField'],
    ['manufacturer', 'settingManufacturer'],
    ['model', 'settingModel'],
    ['statusLabel', 'settingStatusLabel'],
    ['supplier', 'settingSupplier'],
  ] as const)('the %s tab starts with %s and holds five groups', (tab, group) => {
    const codes = FIXED_EQUIPMENT_SETTINGS_CODES[tab];
    expect(codes.read.all[0]).toBe(PERMISSIONS.fixedEquipment[group].view);
    expect(codes.read.own[0]).toBe(PERMISSIONS.fixedEquipment[group].viewOwn);
    for (const list of [codes.read.all, codes.read.own, codes.create, codes.edit, codes.delete]) {
      expect(list).toHaveLength(5);
    }
  });

  it('never mixes the scopes: a view own code is never in the all list', () => {
    for (const { read } of Object.values(FIXED_EQUIPMENT_SETTINGS_CODES)) {
      expect(read.all.every((code) => code.endsWith('.view'))).toBe(true);
      expect(read.own.every((code) => code.endsWith('.viewOwn'))).toBe(true);
    }
  });

  it('Locations has no list: Perfex gates it on its own group only', () => {
    expect(Object.keys(FIXED_EQUIPMENT_SETTINGS_CODES)).not.toContain('location');
  });

  it('the lists are frozen', () => {
    const { depreciation } = FIXED_EQUIPMENT_SETTINGS_CODES;
    expect(Object.isFrozen(depreciation.read.all)).toBe(true);
    expect(Object.isFrozen(depreciation.edit)).toBe(true);
  });
});
