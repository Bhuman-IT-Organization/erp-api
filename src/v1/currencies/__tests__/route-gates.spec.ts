/**
 * The drift gate between `@erp/contracts`' `ROUTE_GATES` and this module's decorators (D-06, D-38):
 * the three `/setup/currencies` screens are `ADMIN_GATE`, every handler of the controller is
 * classified against them, carries exactly `JwtAuthGuard, PermissionGuard`, declares no permission
 * code, and its service method asserts the administrator flag (read from the method's own source:
 * the flag is not a permission code, so metadata cannot show it).
 *
 * `SCREEN_READS` names the read each screen issues when it opens (`/new` reads no record);
 * `OTHER_HANDLERS` files every other handler under the screen that issues it. Their union must
 * equal the controller's own method list, so a new endpoint fails here until it is named.
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
import { CurrenciesController } from '../controller/currencies.controller.js';
import { CurrenciesService } from '../service/currencies.service.js';

type HandlerName = Exclude<keyof CurrenciesController, 'constructor'>;

const SCREEN_READS: Readonly<Record<string, HandlerName | null>> = {
  '/setup/currencies': 'list',
  '/setup/currencies/new': null,
  '/setup/currencies/:id': 'get',
};

const OTHER_HANDLERS: Readonly<Record<string, string>> = {
  exportCsv: '/setup/currencies',
  makeBase: '/setup/currencies',
  remove: '/setup/currencies',
  create: '/setup/currencies/new',
  update: '/setup/currencies/:id',
};

/**
 * The prototype as a plain record of objects: reading a method off the class type would fire
 * `@typescript-eslint/unbound-method`, and the metadata reader wants the function as an opaque
 * target, never as something to call.
 */
const HANDLERS = CurrenciesController.prototype as unknown as Record<string, object>;

const metadata = (key: string, handler: string): unknown =>
  Reflect.getMetadata(key, HANDLERS[handler] ?? {});

const handlerNames = (): string[] =>
  Object.getOwnPropertyNames(CurrenciesController.prototype).filter(
    (name) => name !== 'constructor',
  );

/** The administrator assertion, read from the service method of the same name. */
function assertsAdministrator(handler: string): boolean {
  const method = (CurrenciesService.prototype as unknown as Record<string, unknown>)[handler];
  return typeof method === 'function' && String(method).includes('assertAdministrator(');
}

describe('ROUTE_GATES declares the three currencies screens administrator-only (D-06, D-38)', () => {
  it.each(Object.keys(SCREEN_READS))('%s is gated ADMIN_GATE', (route) => {
    expect(GATED_ROUTES).toContain(route);
    expect(ROUTE_GATES[route]).toBe(ADMIN_GATE);
  });
});

describe('every currencies handler is classified and administrator-only', () => {
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
    'CurrenciesService.%s calls assertAdministrator (every handler, make-base and the delete included, T-4.1-145)',
    (handler) => {
      expect(assertsAdministrator(handler)).toBe(true);
    },
  );

  it('all seven service methods a handler calls assert the flag', () => {
    expect(handlerNames().sort()).toEqual(
      ['create', 'exportCsv', 'get', 'list', 'makeBase', 'remove', 'update'].sort(),
    );
    expect(handlerNames().filter(assertsAdministrator)).toHaveLength(7);
  });
});
