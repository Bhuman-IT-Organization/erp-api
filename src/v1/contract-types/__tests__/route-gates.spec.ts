/**
 * The drift gate between `@erp/contracts`' `ROUTE_GATES` and this module's handlers, in the style of
 * `v1/identity/__tests__/route-gates.spec.ts`. The three screens (`/setup/contract-types`,
 * `/setup/contract-types/new`, `/setup/contract-types/:id`) are administrator-only (D-06, D-26): the map
 * declares them `'admin'`, and this spec VERIFIES the handlers against it rather than restating it.
 *
 * It does not make the map the runtime gate. `PermissionGuard` admits a handler that declares no
 * code, so the service's `assertAdministrator` is the only real control; this file checks that
 * EVERY handler's service method calls it, writes included (T-4.1-79). The e2e spec is the
 * behavioural proof: a bearer holding every catalogue code is refused 403 by each handler, an
 * administrator is not.
 *
 * `SCREEN_READS` names the read each screen issues when it opens (`/new` reads no record);
 * `OTHER_HANDLERS` files every other handler under the screen that issues it. Their union must equal
 * the controller's own method list, so a new endpoint fails here until it is named.
 */
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { ADMIN_GATE, GATED_ROUTES, ROUTE_GATES } from '@erp/contracts';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../../shared/http/decorators/permissions.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { ContractTypesController } from '../controller/contract-types.controller.js';
import { ContractTypesService } from '../service/contract-types.service.js';

type HandlerName = Exclude<keyof ContractTypesController, 'constructor'>;

const SCREEN_READS: Readonly<Record<string, HandlerName | null>> = {
  '/setup/contract-types': 'list',
  '/setup/contract-types/new': null,
  '/setup/contract-types/:id': 'get',
};

const OTHER_HANDLERS: Readonly<Record<string, string>> = {
  exportCsv: '/setup/contract-types',
  remove: '/setup/contract-types',
  create: '/setup/contract-types/new',
  update: '/setup/contract-types/:id',
};

/**
 * The prototype as a plain record of objects: reading a method off the class type would fire
 * `@typescript-eslint/unbound-method`, and the metadata reader wants the function as an opaque
 * target, never as something to call.
 */
const HANDLERS = ContractTypesController.prototype as unknown as Record<string, object>;

const metadata = (key: string, handler: string): unknown =>
  Reflect.getMetadata(key, HANDLERS[handler] ?? {});

const handlerNames = (): string[] =>
  Object.getOwnPropertyNames(ContractTypesController.prototype).filter(
    (name) => name !== 'constructor',
  );

/**
 * The administrator assertion, read from the service method's own source (the handler and the
 * service method share a name). Metadata cannot show it: the flag is not a permission code.
 */
function assertsAdministrator(handler: string): boolean {
  const method = (ContractTypesService.prototype as unknown as Record<string, unknown>)[handler];
  return typeof method === 'function' && String(method).includes('assertAdministrator(');
}

describe('ROUTE_GATES declares the three contract-types screens administrator-only (D-06, D-26)', () => {
  it.each(Object.keys(SCREEN_READS))('%s is gated ADMIN_GATE', (route) => {
    expect(GATED_ROUTES).toContain(route);
    expect(ROUTE_GATES[route]).toBe(ADMIN_GATE);
  });
});

describe('every contract-types handler is classified and administrator-only', () => {
  it('classifies every handler of the controller: a new endpoint fails until it is named here', () => {
    const classified = [
      ...Object.values(SCREEN_READS).filter((name): name is HandlerName => name !== null),
      ...Object.keys(OTHER_HANDLERS),
    ].sort();
    expect(handlerNames().sort()).toEqual(classified);
    const unknown = Object.values(OTHER_HANDLERS).filter((route) => !(route in SCREEN_READS));
    expect(unknown, 'a handler is filed against a screen that is not gated').toEqual([]);
  });

  it.each(handlerNames())('%s carries exactly JwtAuthGuard, PermissionGuard', (handler) => {
    expect(metadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, PermissionGuard]);
  });

  it.each(handlerNames())(
    '%s declares no permission code: a route gated admin admits no @Permissions or @PermissionsAny',
    (handler) => {
      expect(metadata(PERMISSIONS_KEY, handler), `${handler}: no @Permissions`).toBeUndefined();
      expect(
        metadata(PERMISSIONS_ANY_KEY, handler),
        `${handler}: no @PermissionsAny`,
      ).toBeUndefined();
    },
  );

  it.each(handlerNames())(
    'ContractTypesService.%s calls assertAdministrator (every handler, writes included, T-4.1-79)',
    (handler) => {
      expect(assertsAdministrator(handler)).toBe(true);
    },
  );
});
