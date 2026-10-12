import { describe, expect, it } from 'vitest';
import { LoggerService, type LogMeta } from '../../../shared/logger/logger.service.js';
import type { StaffIdentity } from '../model/auth.model.js';
import { AuthEnricher } from '../service/auth.enricher.js';

const staff: StaffIdentity = {
  staffId: 12,
  email: 'someone@example.test',
  firstName: 'Some',
  lastName: 'One',
  isAdmin: false,
  roleId: 2,
  active: true,
  twoFactorEnabled: false,
  passwordHash: '$2y$12$fixture-not-a-real-hash',
  locale: null,
};
const builtAt = new Date('2026-09-19T10:00:00.000Z');

/** Captures the warn lines so the spec can assert the message carries a count and no code. */
class RecordingLogger extends LoggerService {
  readonly warnings: { message: string; meta: LogMeta | undefined }[] = [];

  override warn(message: string, meta?: LogMeta): void {
    this.warnings.push({ message, meta });
  }
}

const build = (): { enricher: AuthEnricher; logger: RecordingLogger } => {
  const logger = new RecordingLogger();
  return { enricher: new AuthEnricher(logger), logger };
};

describe('AuthEnricher.buildPermissionSnapshot', () => {
  it('translates Perfex rows into the clean ADR-0033 names, sorted and de-duplicated', () => {
    const { enricher } = build();
    const snapshot = enricher.buildPermissionSnapshot(
      staff,
      [
        { feature: 'invoices', capability: 'view' },
        { feature: 'customers', capability: 'create' },
        { feature: 'invoices', capability: 'view' },
        { feature: 'invoices', capability: 'create' },
        { feature: 'purchase_orders', capability: 'view_own' },
        { feature: 'wh_stock_import', capability: 'create' },
        { feature: 'hrp_insurrance', capability: 'view' },
      ],
      builtAt,
    );
    expect(snapshot.codes).toEqual([
      'crm.customers.create',
      'payroll.insurance.view',
      'purchase.orders.viewOwn',
      'sales.invoices.create',
      'sales.invoices.view',
      'warehouse.stockImport.create',
    ]);
  });

  it('carries no Perfex naming into the snapshot', () => {
    const { enricher } = build();
    const snapshot = enricher.buildPermissionSnapshot(
      staff,
      [
        { feature: 'staff', capability: 'view' },
        { feature: 'roles', capability: 'view' },
      ],
      builtAt,
    );
    expect(snapshot.codes).toEqual(['staff.members.view', 'staff.roles.view']);
    expect(snapshot.codes.some((code) => code.includes('_'))).toBe(false);
  });

  it('drops a row the mapping does not carry and leaves the rest untouched', () => {
    const { enricher, logger } = build();
    const snapshot = enricher.buildPermissionSnapshot(
      staff,
      [
        { feature: 'staff', capability: 'view' },
        // The swapped-order anomaly of Perfex's permission data: never declared, so never
        // mapped. It is dropped rather than passed through, or `edit.tasks` would reach `/me`.
        { feature: 'edit', capability: 'tasks' },
        { feature: 'goals', capability: 'view' },
        { feature: 'roles', capability: 'view' },
      ],
      builtAt,
    );
    expect(snapshot.codes).toEqual(['staff.members.view', 'staff.roles.view']);
    expect(snapshot.codes).not.toContain('edit.tasks');
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]?.meta).toEqual({ staffId: 12, dropped: 2 });
  });

  it('logs no warning and names no permission code when every row maps', () => {
    const { enricher, logger } = build();
    enricher.buildPermissionSnapshot(staff, [{ feature: 'staff', capability: 'view' }], builtAt);
    expect(logger.warnings).toEqual([]);
  });

  it('never puts a permission code in the warn line', () => {
    const { enricher, logger } = build();
    enricher.buildPermissionSnapshot(staff, [{ feature: 'edit', capability: 'tasks' }], builtAt);
    const line = JSON.stringify(logger.warnings);
    expect(line).not.toContain('edit.tasks');
    expect(line).toContain('"dropped":1');
  });

  it('mirrors isAdmin, roleId and staffId from the identity', () => {
    const { enricher } = build();
    const admin = enricher.buildPermissionSnapshot({ ...staff, isAdmin: true }, [], builtAt);
    expect(admin.isAdmin).toBe(true);
    expect(admin.roleId).toBe(2);
    expect(admin.staffId).toBe(12);
    const noRole = enricher.buildPermissionSnapshot({ ...staff, roleId: null }, [], builtAt);
    expect(noRole.isAdmin).toBe(false);
    expect(noRole.roleId).toBeNull();
  });

  it('gives an empty code list for no rows', () => {
    const { enricher } = build();
    expect(enricher.buildPermissionSnapshot(staff, [], builtAt).codes).toEqual([]);
  });

  it('is version 1 with an ISO builtAt', () => {
    const { enricher } = build();
    const snapshot = enricher.buildPermissionSnapshot(staff, [], builtAt);
    expect(snapshot.v).toBe(1);
    expect(snapshot.builtAt).toBe('2026-09-19T10:00:00.000Z');
  });

  it('is deterministic: the same rows in another order build the same snapshot', () => {
    const { enricher } = build();
    const rows = [
      { feature: 'invoices', capability: 'view' },
      { feature: 'customers', capability: 'create' },
    ];
    const one = enricher.buildPermissionSnapshot(staff, rows, builtAt);
    const two = enricher.buildPermissionSnapshot(staff, [...rows].reverse(), builtAt);
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });
});
