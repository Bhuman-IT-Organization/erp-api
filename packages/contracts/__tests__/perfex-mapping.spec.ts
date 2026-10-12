/**
 * The 1:1 harness ADR-0033 requires: the Perfex → clean mapping covers every ACTIVE declared Perfex
 * code, exactly once, with a name the catalogue declares. It runs against the pinned copy of
 * `legacy-rbac.json` (D-17), never against the sibling repository, so `corepack yarn test` has no
 * cross-repo dependency; only the sha256 assertion looks at the sibling, and it skips when absent.
 *
 * Every structural assertion holds trivially over an empty mapping and is never made permissive —
 * only the declared coverage number below moves.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PERMISSION_CODES } from '../src/permissions.catalogue.js';
import {
  BROKEN_CHECK_INTENT,
  PERFEX_TO_CLEAN,
  toCleanPermission,
  toPerfexPermission,
} from '../src/perfex-mapping.js';

/**
 * The number of ACTIVE declared Perfex codes the mapping is expected to cover.
 * Plan 03 set it to 0 (the mapping was empty). Plan 10 set it to 507 and authored the rows.
 * It only ever moves upward, and never to a value below the count the mapping actually holds.
 */
export const EXPECTED_MAPPED_CODES = 507;

/** The `extraction` block's own count of active declared codes — assertion 7 pins the population. */
const DECLARED_ACTIVE_CODES = 507;

/** `module.resource.action` — the ADR-0033 clean-name grammar. */
const CLEAN_NAME = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){2}$/;

interface DeclaredRecord {
  readonly active: boolean;
  readonly capability: string;
  readonly code: string;
  readonly feature: string;
  readonly not_applicable: boolean;
  readonly source: string;
}
interface LegacyRbac {
  readonly checked_not_declared: readonly { readonly code: string }[];
  readonly declared: readonly DeclaredRecord[];
  readonly extraction: { readonly declared_active_codes: number };
}

const PINNED = join(import.meta.dirname, '..', 'src', 'legacy-rbac.json');

const register = JSON.parse(readFileSync(PINNED, 'utf8')) as LegacyRbac;
const activeCodes = new Set(
  register.declared.filter((row) => row.active).map((row) => `${row.feature}.${row.capability}`),
);

describe('the Perfex → clean permission mapping', () => {
  it('covers exactly the declared number of active Perfex codes', () => {
    expect(
      Object.keys(PERFEX_TO_CLEAN).length,
      'raise EXPECTED_MAPPED_CODES together with the rows it counts (plan 03.1-10 sets it to 507)',
    ).toBe(EXPECTED_MAPPED_CODES);
  });

  it('maps no code the register does not declare as active', () => {
    const invented = Object.keys(PERFEX_TO_CLEAN).filter((code) => !activeCodes.has(code));
    expect(invented, `not an active declared Perfex code: ${invented.join(', ')}`).toEqual([]);
  });

  it('is one-to-one: no clean name is produced by two different Perfex codes', () => {
    const cleanNames = Object.values(PERFEX_TO_CLEAN);
    const seen = new Set<string>();
    const duplicated = cleanNames.filter((name) =>
      seen.has(name) ? true : (seen.add(name), false),
    );
    expect(
      duplicated,
      `clean names reached from two Perfex codes: ${duplicated.join(', ')}`,
    ).toEqual([]);
  });

  it('produces only names the catalogue declares', () => {
    const catalogue = new Set(PERMISSION_CODES);
    const unknown = Object.values(PERFEX_TO_CLEAN).filter((name) => !catalogue.has(name));
    expect(unknown, `not in PERMISSION_CODES: ${unknown.join(', ')}`).toEqual([]);
  });

  it('produces only `module.resource.action` names', () => {
    const malformed = Object.values(PERFEX_TO_CLEAN).filter((name) => !CLEAN_NAME.test(name));
    expect(malformed, `not module.resource.action: ${malformed.join(', ')}`).toEqual([]);
  });

  it('returns null for a Perfex code the mapping does not carry', () => {
    expect(toCleanPermission('no_such_feature.no_such_capability')).toBeNull();
  });

  it('round-trips: toPerfexPermission(toCleanPermission(code)) is the identity for every mapped code', () => {
    const broken = Object.keys(PERFEX_TO_CLEAN).filter((code) => {
      const clean = toCleanPermission(code);
      return clean === null || toPerfexPermission(clean) !== code;
    });
    expect(
      broken,
      `the write direction does not return these Perfex codes: ${broken.join(', ')}`,
    ).toEqual([]);
  });

  it('returns null from the write direction for a clean name the catalogue does not declare', () => {
    expect(toPerfexPermission('no.such.permission')).toBeNull();
  });

  /**
   * CR review BL-1. Both maps are plain objects, so before the `Object.hasOwn` fix a key inherited
   * from `Object.prototype` answered with a function or a prototype and `?? null` never fired —
   * `identity.service.ts` then called `.lastIndexOf` on it and turned a 422 `ERP-IDENTITY-0003`
   * into a 500. A caller reaches these keys with nothing more exotic than
   * `permissions: ["constructor"]` in a request body, so both directions are asserted.
   */
  const PROTOTYPE_KEYS = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];

  it.each(PROTOTYPE_KEYS)(
    'returns null from the read direction for the inherited key %s (BL-1)',
    (key) => {
      expect(toCleanPermission(key)).toBeNull();
    },
  );

  it.each(PROTOTYPE_KEYS)(
    'returns null from the write direction for the inherited key %s (BL-1)',
    (key) => {
      expect(toPerfexPermission(key)).toBeNull();
    },
  );
});

describe('the pinned legacy-rbac.json register', () => {
  it('still reports the population EXPECTED_MAPPED_CODES is counted against', () => {
    expect(register.extraction.declared_active_codes).toBe(DECLARED_ACTIVE_CODES);
    expect(activeCodes.size).toBe(DECLARED_ACTIVE_CODES);
  });
});

describe('BROKEN_CHECK_INTENT (D-36, warehouse brief section 5)', () => {
  it('names exactly the five broken checks plan 04.2-02 maps', () => {
    expect(Object.keys(BROKEN_CHECK_INTENT).sort()).toEqual([
      'warehouse.create',
      'warehouse.delete',
      'warehouse.edit',
      'wh_packing_list.delete()',
      'wh_receipt_return_order.delete()',
    ]);
  });

  it('keys only checks the register lists as checked but not declared', () => {
    const broken = new Set(register.checked_not_declared.map((row) => row.code));
    const unknown = Object.keys(BROKEN_CHECK_INTENT).filter((code) => !broken.has(code));
    expect(unknown).toEqual([]);
  });

  it('maps each one to a catalogue code', () => {
    const catalogue = new Set<string>(PERMISSION_CODES);
    const unknown = Object.values(BROKEN_CHECK_INTENT).filter((code) => !catalogue.has(code));
    expect(unknown).toEqual([]);
  });

  it('stays out of PERFEX_TO_CLEAN, so the role writer never emits one, and the map stays 507', () => {
    const leaked = Object.keys(BROKEN_CHECK_INTENT).filter((code) =>
      Object.hasOwn(PERFEX_TO_CLEAN, code),
    );
    expect(leaked).toEqual([]);
    expect(Object.keys(PERFEX_TO_CLEAN)).toHaveLength(EXPECTED_MAPPED_CODES);
  });
});
