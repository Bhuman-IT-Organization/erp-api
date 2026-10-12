import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../app-config.js';
import {
  MODULE_DISABLED_CODES,
  MODULE_NAMES,
  ModuleSwitch,
  parseModulesDisabled,
  type ModuleName,
} from '../modules.js';

function switchOf(disabled: readonly ModuleName[]): ModuleSwitch {
  return new ModuleSwitch({ env: { MODULES_DISABLED: disabled } } as unknown as AppConfig);
}

describe('parseModulesDisabled (ADR-0042)', () => {
  it('reads an empty value as every module on', () => {
    expect(parseModulesDisabled('')).toEqual([]);
  });

  it('drops empties', () => {
    expect(parseModulesDisabled(' , ,, ')).toEqual([]);
  });

  it('refuses an unknown name, naming it and the known list (T-4.2-79)', () => {
    expect(() => parseModulesDisabled('stock')).toThrow(
      'MODULES_DISABLED names an unknown module: stock (known: none)',
    );
  });

  it('knows no switchable module yet, so no 403 code is registered', () => {
    expect(MODULE_NAMES).toEqual([]);
    expect(MODULE_DISABLED_CODES).toEqual({});
    expect(Object.isFrozen(MODULE_DISABLED_CODES)).toBe(true);
  });
});

describe('ModuleSwitch', () => {
  // No module is switchable yet; a stand-in name exercises the switch's own logic.
  const sample = 'sample' as ModuleName;

  it('passes every module while nothing is switched off', () => {
    const modules = switchOf([]);
    expect(modules.disabled()).toEqual([]);
    expect(modules.isEnabled(sample)).toBe(true);
    expect(() => {
      modules.assertEnabled(sample);
    }).not.toThrow();
  });

  it('reports a switched-off module as off', () => {
    const modules = switchOf([sample]);
    expect(modules.disabled()).toEqual([sample]);
    expect(modules.isEnabled(sample)).toBe(false);
  });
});
