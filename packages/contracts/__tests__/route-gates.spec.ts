/**
 * The gate lookup's own contract, on the `@erp/contracts` copy (erp-web's
 * `src/config/route-gates.ts` carries the same body and the same cases). An exact key must win
 * before an `:id` pattern: keys are walked sorted, and `':'` (0x3A) sorts before every letter, so a
 * pattern-only walk answered `/x/:id`'s gate for `/x/new` (03.2 RESEARCH Pitfall 6). Harmless while
 * both carry one gate; wrong the day a create screen is gated apart from a view.
 *
 * `src/v1/identity/__tests__/route-gates.spec.ts` ties the handlers' decorators to the map; this
 * file only pins the lookup.
 */
import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from '../src/permissions.catalogue.js';
import {
  ADMIN_GATE,
  GATED_ROUTES,
  isAnyOfGate,
  ROUTE_GATES,
  routeGateIn,
  routeGateOf,
  type RouteGate,
} from '../src/route-gates.js';

const GATES: Readonly<Record<string, RouteGate>> = { '/x/:id': 'a', '/x/new': 'b' };

describe('routeGateIn (exact key first, then an :id pattern)', () => {
  it('answers the exact key before an :id pattern: /x/new is b, not a', () => {
    expect(routeGateIn(GATES, '/x/new')).toBe('b');
  });

  it('resolves /setup/staff/new and /setup/roles/new through their own keys, not through /:id', () => {
    // Each real key mapped to its own name, so the answer says WHICH key matched.
    const own = Object.fromEntries(GATED_ROUTES.map((route) => [route, route]));
    expect(routeGateIn(own, '/setup/staff/new')).toBe('/setup/staff/new');
    expect(routeGateIn(own, '/setup/roles/new')).toBe('/setup/roles/new');
    expect(routeGateIn(own, '/setup/staff/12')).toBe('/setup/staff/:id');
  });

  it('matches an :id pattern for any other single segment, and ignores a query string', () => {
    expect(routeGateIn(GATES, '/x/12')).toBe('a');
    expect(routeGateIn(GATES, '/x/12?tab=1')).toBe('a');
  });

  it('says nothing about a path no key names', () => {
    expect(routeGateIn(GATES, '/y')).toBeUndefined();
    expect(routeGateIn(GATES, '/x')).toBeUndefined();
  });
});

describe('routeGateOf (routeGateIn over ROUTE_GATES)', () => {
  it('still gives /setup/staff/new and /setup/roles/7 the gates they have today', () => {
    expect(routeGateOf('/setup/staff/new')).toBe(ROUTE_GATES['/setup/staff/new']);
    expect(routeGateOf('/setup/roles/7')).toBe(ADMIN_GATE);
  });
});

describe('any-of gates and :name segments (plan 04.2-02, PATTERNS M2)', () => {
  it('isAnyOfGate is true for an array and false for a code or the administrator flag', () => {
    expect(isAnyOfGate([PERMISSIONS.staff.members.view])).toBe(true);
    expect(isAnyOfGate(PERMISSIONS.staff.members.view)).toBe(false);
    expect(isAnyOfGate(ADMIN_GATE)).toBe(false);
  });
});

describe('the Email screens (plan 04.3-07, D-09)', () => {
  it('gates the template list and editor on the mapped view code', () => {
    expect(ROUTE_GATES['/setup/email-templates']).toBe(PERMISSIONS.settings.emailTemplates.view);
    expect(ROUTE_GATES['/setup/email-templates/:id']).toBe(
      PERMISSIONS.settings.emailTemplates.view,
    );
    expect(routeGateOf('/setup/email-templates/12')).toBe(PERMISSIONS.settings.emailTemplates.view);
  });

  it('keeps the sent-email log, its detail and the status page administrator-only', () => {
    expect(ROUTE_GATES['/setup/sent-emails']).toBe(ADMIN_GATE);
    expect(ROUTE_GATES['/setup/sent-emails/:id']).toBe(ADMIN_GATE);
    expect(ROUTE_GATES['/setup/email-status']).toBe(ADMIN_GATE);
    expect(routeGateOf('/setup/sent-emails/12')).toBe(ADMIN_GATE);
  });
});

describe('user-facing paths follow the menu (plan 04.2-27, lead 2026-10-04)', () => {
  it('gates staff and roles under /setup', () => {
    expect(routeGateOf('/setup/staff/12')).toBe(PERMISSIONS.staff.members.view);
    expect(routeGateOf('/setup/roles/new')).toBe(ADMIN_GATE);
  });
});

describe('the old screen paths declare no gate (plan 04.2-27; Nginx redirects them in 04.2-29)', () => {
  it.each(['/staff', '/roles/3'])('%s is undefined', (path) => {
    expect(routeGateOf(path)).toBeUndefined();
  });
});
