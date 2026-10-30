/**
 * The drift gate between `@erp/contracts`' `ROUTE_GATES` and this module's decorators.
 *
 * `/setup/roles` drifted because its gate was declared twice: erp-web's `config/navigation.ts` said
 * `adminOnly: true`, this controller said `@Permissions(staff.roles.view)` — and nothing compared
 * the two (migration-lead decision 2026-09-24). `ROUTE_GATES` is
 * now the single declaration; this spec VERIFIES rather than restates it.
 *
 * **It does not make the map the runtime gate.** Every handler still authorises for itself: the
 * decorators and `IdentityService.assertAdministrator` are the control, and this file only compares
 * them with what the map declares. Moving authorisation into a shared map would take it out of the
 * module that owns the data (ADR-0034 decision 1).
 *
 * What it checks, per handler:
 * - a route gated `'admin'` → the handler carries NEITHER `@Permissions` nor `@PermissionsAny`, and
 *   the service method it calls asserts the administrator flag;
 * - a route gated on a code → the handler carries exactly that one code under `@Permissions`;
 * - a write on an administrator-only route declares no code either — that is the property that
 *   stops one role write being left on a grantable code.
 *
 * Every handler of the controller must be classified: the union of `SCREEN_READS` and
 * `OTHER_HANDLERS` is asserted equal to the controller's own method list, so a new endpoint fails
 * this spec until somebody says which screen gate governs it.
 */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_GATE,
  GATED_ROUTES,
  isPermissionCode,
  PERMISSION_CODES,
  PERMISSIONS,
  ROUTE_GATES,
  routeGateOf,
  type RouteGate,
} from '@erp/contracts';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../../shared/http/decorators/permissions.decorator.js';
import { IdentityController } from '../controller/identity.controller.js';
import { IdentityService } from '../service/identity.service.js';

type HandlerName = keyof IdentityController;

const MIN_CATALOGUE_CODES = 507;

/**
 * The handler that serves each gated route's READ — the request a member makes by opening the
 * screen. `/setup/staff/new` and `/setup/roles/new` read no record of their own (the create screens read the
 * lookups, which carry their own gates), so they are `null`: the map's consistency is still checked,
 * there is simply no handler to compare.
 */
const SCREEN_READS: Readonly<Record<string, HandlerName | null>> = {
  '/setup/staff': 'listMembers',
  '/setup/staff/new': null,
  '/setup/staff/:id': 'getMember',
  '/setup/roles': 'listRoles',
  '/setup/roles/new': null,
  '/setup/roles/:id': 'getRole',
};

/**
 * Every other handler, against the route whose screen issues it. The value is what makes the
 * classification complete, and it is what selects the writes on an administrator-only route for the
 * no-code assertion below. A write on a code-gated route legitimately declares its own, stronger
 * code (`staff.members.create`/`edit`) and a lookup declares the view code of the form that reads
 * it, so neither is compared with the screen's gate — `identity.controller.e2e.spec.ts` owns those.
 */
const OTHER_HANDLERS: Readonly<Record<string, string>> = {
  createMember: '/setup/staff/new',
  updateMember: '/setup/staff/:id',
  setMemberStatus: '/setup/staff',
  createRole: '/setup/roles/new',
  updateRole: '/setup/roles/:id',
  deleteRole: '/setup/roles/:id',
  getPermissionCatalogue: '/setup/staff/:id',
  listLocales: '/setup/staff/:id',
  listDepartments: '/setup/staff/:id',
  // The audit log has no screen in this phase; it is administrator-only through the service, and
  // `identity.service.spec.ts` owns that. Listed so the classification is complete.
  listAudit: '/setup/staff',
  // Plan 03.2-05: each export is gated exactly like the list it downloads. `/setup/roles` is 'admin', so
  // the assertion below proves `exportRoles` declares no code; the e2e spec proves the 403s.
  exportMembers: '/setup/staff',
  exportRoles: '/setup/roles',
};

const handlerNames = (): HandlerName[] =>
  Object.getOwnPropertyNames(IdentityController.prototype).filter(
    (name): name is HandlerName => name !== 'constructor',
  );

/**
 * The prototype as a plain record of objects: reading a method off the class type would fire
 * `@typescript-eslint/unbound-method` (correctly — a detached method is usually a bug), and the
 * metadata reader wants the function as an opaque target, never as something to call.
 */
const HANDLERS = IdentityController.prototype as unknown as Record<string, object>;

const codesOn = (key: string, handler: HandlerName): readonly string[] | undefined =>
  Reflect.getMetadata(key, HANDLERS[handler] ?? {}) as readonly string[] | undefined;

/**
 * The administrator assertion, read from the service method's own source. Metadata cannot show it —
 * the flag is not a permission code and `PermissionGuard` has no `isAdmin` branch (ADR-0033 d.4) —
 * so the check is the same species as the catalogue mirror's: a regex over the declaration that
 * carries the decision. The e2e spec is the behavioural proof (403 for a bearer holding every code,
 * 200 for an administrator).
 */
function assertsAdministrator(handler: HandlerName): boolean {
  const method = (IdentityService.prototype as unknown as Record<string, unknown>)[handler];
  return typeof method === 'function' && String(method).includes('assertAdministrator(');
}

describe('ROUTE_GATES is a well-formed declaration', () => {
  it('is frozen, and every value is a catalogue code, an any-of list of them, or the administrator flag', () => {
    expect(Object.isFrozen(ROUTE_GATES)).toBe(true);
    expect(PERMISSION_CODES.length).toBeGreaterThanOrEqual(MIN_CATALOGUE_CODES);
    for (const route of GATED_ROUTES) {
      const gate: RouteGate | undefined = ROUTE_GATES[route];
      expect(gate, `${route} has no gate`).toBeDefined();
      // Plan 04.2-02: an any-of gate is a non-empty list of distinct catalogue codes.
      const declared = Array.isArray(gate)
        ? gate.length > 0 &&
          new Set(gate).size === gate.length &&
          gate.every((code) => isPermissionCode(code))
        : gate === ADMIN_GATE || isPermissionCode(gate);
      expect(
        declared,
        `${route}: ${String(gate)} is neither 'admin', a catalogue code nor a list of distinct codes`,
      ).toBe(true);
    }
  });

  it('covers exactly the declared routes, each an absolute path with at most one :name segment', () => {
    expect(GATED_ROUTES).toEqual([
      '/setup/cost-centers',
      '/setup/cost-centers/:id',
      '/setup/cost-centers/new',
      '/setup/currencies',
      '/setup/currencies/:id',
      '/setup/currencies/new',
      '/setup/customer-groups',
      '/setup/customer-groups/:id',
      '/setup/customer-groups/new',
      '/setup/email-status',
      '/setup/email-templates',
      '/setup/email-templates/:id',
      '/setup/expense-categories',
      '/setup/expense-categories/:id',
      '/setup/expense-categories/new',
      '/setup/lead-sources',
      '/setup/lead-sources/:id',
      '/setup/lead-sources/new',
      '/setup/payment-modes',
      '/setup/payment-modes/:id',
      '/setup/payment-modes/new',
      '/setup/roles',
      '/setup/roles/:id',
      '/setup/roles/new',
      '/setup/sent-emails',
      '/setup/sent-emails/:id',
      '/setup/services',
      '/setup/services/:id',
      '/setup/services/new',
      '/setup/staff',
      '/setup/staff/:id',
      '/setup/staff/new',
      '/setup/taxes',
      '/setup/taxes/:id',
      '/setup/taxes/new',
      '/setup/ticket-priorities',
      '/setup/ticket-priorities/:id',
      '/setup/ticket-priorities/new',
      '/setup/ticket-statuses',
      '/setup/ticket-statuses/:id',
      '/setup/ticket-statuses/new',
    ]);
    for (const route of GATED_ROUTES) {
      expect(route.startsWith('/'), route).toBe(true);
      const dynamic = route.split('/').filter((segment) => segment.startsWith(':'));
      expect(dynamic.length, route).toBeLessThanOrEqual(1);
    }
  });

  it('resolves a concrete pathname to its declared gate, and an undeclared one to undefined', () => {
    expect(routeGateOf('/setup/roles')).toBe(ADMIN_GATE);
    expect(routeGateOf('/setup/roles/12')).toBe(ADMIN_GATE);
    expect(routeGateOf('/setup/roles/new')).toBe(ADMIN_GATE);
    expect(routeGateOf('/setup/staff/12')).toBe(ROUTE_GATES['/setup/staff/:id']);
    expect(routeGateOf('/setup/staff/12?tab=permissions')).toBe(ROUTE_GATES['/setup/staff/:id']);
    expect(routeGateOf('/admin/roles')).toBeUndefined();
    expect(routeGateOf('/setup/roles/12/edit')).toBeUndefined();
  });

  it('declares the staff and roles screens under /setup (plan 04.2-27)', () => {
    expect(routeGateOf('/setup/staff')).toBe(PERMISSIONS.staff.members.view);
    expect(routeGateOf('/setup/staff/12')).toBe(PERMISSIONS.staff.members.view);
    expect(routeGateOf('/setup/roles/12')).toBe(ADMIN_GATE);
  });
});

describe('every identity handler matches the gate ROUTE_GATES declares for its screen', () => {
  it('classifies every handler of the controller — a new endpoint fails until it is named here', () => {
    const classified = [
      ...Object.values(SCREEN_READS).filter((name): name is HandlerName => name !== null),
      ...Object.keys(OTHER_HANDLERS),
    ].sort();
    expect(handlerNames().sort()).toEqual(classified);
    // Identity's own screens only: other modules' routes (/setup/expense-categories*, /setup/taxes*, /setup/cost-centers*, /setup/payment-modes*, /setup/currencies*) are checked by their own spec.
    expect(Object.keys(SCREEN_READS).sort()).toEqual(
      GATED_ROUTES.filter((r) => r.startsWith('/setup/staff') || r.startsWith('/setup/roles')),
    );
    const unknown = Object.values(OTHER_HANDLERS).filter((route) => !GATED_ROUTES.includes(route));
    expect(unknown, 'a handler is filed against a route the map does not declare').toEqual([]);
  });

  it.each(
    Object.entries(SCREEN_READS)
      .filter((entry): entry is [string, HandlerName] => entry[1] !== null)
      .map(([route, handler]) => [route, handler, ROUTE_GATES[route]] as const),
  )("%s -> %s carries exactly the map's gate", (route, handler, gate) => {
    if (gate === ADMIN_GATE) {
      expect(
        codesOn(PERMISSIONS_KEY, handler),
        `${handler}: a route gated 'admin' admits no @Permissions`,
      ).toBeUndefined();
      expect(
        codesOn(PERMISSIONS_ANY_KEY, handler),
        `${handler}: a route gated 'admin' admits no @PermissionsAny`,
      ).toBeUndefined();
      expect(
        assertsAdministrator(handler),
        `IdentityService.${handler} must call assertAdministrator (${route} is gated 'admin')`,
      ).toBe(true);
      return;
    }
    expect(
      codesOn(PERMISSIONS_KEY, handler),
      `${handler} must declare exactly [${String(gate)}]`,
    ).toEqual([gate]);
    expect(codesOn(PERMISSIONS_ANY_KEY, handler)).toBeUndefined();
  });

  it.each(Object.entries(OTHER_HANDLERS).filter(([, route]) => ROUTE_GATES[route] === ADMIN_GATE))(
    '%s serves an administrator-only route, so it declares no permission code either',
    (handler) => {
      const name = handler as HandlerName;
      expect(codesOn(PERMISSIONS_KEY, name), `${handler} must declare no code`).toBeUndefined();
      expect(codesOn(PERMISSIONS_ANY_KEY, name)).toBeUndefined();
    },
  );

  /**
   * The code that carried the drift is deliberately NOT deleted: `@erp/contracts` must stay 1:1 with
   * every active Perfex code (ADR-0033) and Perfex's own roles screen still checks it during
   * coexistence. It must simply gate no roles endpoint.
   *
   * It is not yet *unused*, and that is recorded rather than quietly changed: `GET
   * permissions/catalogue` still admits it through its any-of, per identity-access brief §5's
   * correction table. The catalogue is the list of 507 NAMES, not a role's template, so it is not
   * the capability the 2026-09-24 decision withdrew — but this assertion pins the exception to that
   * one handler so it cannot spread.
   */
  it('no roles handler declares staff.roles.view; the catalogue read is its one remaining home', () => {
    const rolesView: string = PERMISSIONS.staff.roles.view;
    expect(PERMISSION_CODES).toContain(rolesView);
    const declaring = handlerNames().filter((handler) =>
      [
        ...(codesOn(PERMISSIONS_KEY, handler) ?? []),
        ...(codesOn(PERMISSIONS_ANY_KEY, handler) ?? []),
      ].includes(rolesView),
    );
    expect(declaring).toEqual(['getPermissionCatalogue']);
  });
});
