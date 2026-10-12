/**
 * IdentityEnricher: the read-direction ADR-0033 translation point. A stored Perfex row with no
 * mapping entry is dropped and COUNTED — one `warn` carrying the count and never the code (threat
 * T-3.1-25) — and the result is sorted and de-duplicated. `enrich` is pure.
 */
import { describe, expect, it, vi } from 'vitest';
import { PERMISSION_CODES } from '@erp/contracts';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { IdentityEnricher } from '../service/identity.enricher.js';
import { SEED_MEMBERS } from './fakes.js';

function enricherWithSpy(): { enricher: IdentityEnricher; warn: ReturnType<typeof vi.fn> } {
  const logger = new LoggerService();
  const warn = vi.fn();
  vi.spyOn(logger, 'warn').mockImplementation(warn);
  return { enricher: new IdentityEnricher(logger), warn };
}

const STAFF_ID = 2;

describe('IdentityEnricher.toCleanPermissions', () => {
  it('translates Perfex rows into sorted, de-duplicated clean names', () => {
    const { enricher, warn } = enricherWithSpy();
    const clean = enricher.toCleanPermissions(STAFF_ID, [
      { feature: 'staff', capability: 'view' },
      { feature: 'roles', capability: 'view' },
      { feature: 'staff', capability: 'view' },
    ]);
    expect(clean).toEqual(['staff.members.view', 'staff.roles.view']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops an unmapped row, counts it in one warn, and never names the code', () => {
    const { enricher, warn } = enricherWithSpy();
    const clean = enricher.toCleanPermissions(STAFF_ID, [
      { feature: 'staff', capability: 'view' },
      { feature: 'edit', capability: 'tasks' },
      { feature: 'no', capability: 'suchthing' },
    ]);
    expect(clean).toEqual(['staff.members.view']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('permission rows dropped: no mapping entry', {
      staffId: STAFF_ID,
      dropped: 2,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('edit.tasks');
  });

  it('answers an empty list for a member with no rows and warns nothing', () => {
    const { enricher, warn } = enricherWithSpy();
    expect(enricher.toCleanPermissions(STAFF_ID, [])).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('IdentityEnricher.enrich', () => {
  it('adds departments, permissions and the role name without mutating its input', () => {
    const { enricher } = enricherWithSpy();
    const member = SEED_MEMBERS[1];
    if (member === undefined) throw new Error('seed member missing');
    const before = { ...member };
    const enriched = enricher.enrich(member, [2], ['staff.members.view'], 'Seed role A');
    expect(enriched.departmentIds).toEqual([2]);
    expect(enriched.permissions).toEqual(['staff.members.view']);
    expect(enriched.roleName).toBe('Seed role A');
    expect(member).toEqual(before);
  });
});

describe('IdentityEnricher.toCleanTemplate', () => {
  const ROLE_ID = 10;

  it('translates a stored role template into sorted, de-duplicated clean names', () => {
    const { enricher, warn } = enricherWithSpy();
    expect(enricher.toCleanTemplate(ROLE_ID, { staff: ['view', 'edit'], roles: ['view'] })).toEqual(
      ['staff.members.edit', 'staff.members.view', 'staff.roles.view'],
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops and counts a pair the mapping does not know, naming neither pair nor code', () => {
    const { enricher, warn } = enricherWithSpy();
    expect(enricher.toCleanTemplate(ROLE_ID, { edit: ['tasks'], staff: ['view'] })).toEqual([
      'staff.members.view',
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('role template rows dropped: no mapping entry', {
      roleId: ROLE_ID,
      dropped: 1,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('edit.tasks');
  });

  it('answers [] for an empty template', () => {
    const { enricher } = enricherWithSpy();
    expect(enricher.toCleanTemplate(ROLE_ID, {})).toEqual([]);
  });
});

describe('IdentityEnricher.buildPermissionCatalogue', () => {
  it('covers every catalogue code exactly once, grouped module -> resource -> action', () => {
    const { enricher } = enricherWithSpy();
    const modules = enricher.buildPermissionCatalogue();
    const codes = modules.flatMap((module) =>
      module.resources.flatMap((resource) => resource.actions.map((action) => action.code)),
    );
    expect(codes.length).toBe(PERMISSION_CODES.length);
    expect([...codes].sort()).toEqual([...PERMISSION_CODES].sort());
  });

  it('names each code as `<module>.<resource>.<action>` of the branch it sits in', () => {
    const { enricher } = enricherWithSpy();
    for (const module of enricher.buildPermissionCatalogue()) {
      for (const resource of module.resources) {
        for (const action of resource.actions) {
          expect(action.code).toBe(`${module.module}.${resource.resource}.${action.action}`);
        }
      }
    }
  });

  it('is pure: two calls answer the same tree', () => {
    const { enricher } = enricherWithSpy();
    expect(enricher.buildPermissionCatalogue()).toEqual(enricher.buildPermissionCatalogue());
  });
});
